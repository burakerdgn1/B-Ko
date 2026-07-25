import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { ConversationModule } from './conversation.module';
import { ConversationService } from './conversation.service';
import { ChannelAdapter, IncomingMessage } from '../channels/channel.adapter';
import { MockChannelAdapter } from '../channels/mock/mock.adapter';
import { UserRepository } from '../persistence/repositories/user.repository';
import { DraftRepository } from '../persistence/repositories/draft.repository';
import { DocumentRepository } from '../persistence/repositories/document.repository';

/**
 * Sohbet akışı testleri — botun ürün akışına bağlandığı son halka.
 *
 * En kritik iki iddia:
 *   1. Açık rıza (consent) olmadan HİÇBİR belge işlenmez.
 *   2. Hiçbir şey kullanıcı adına resmî kuruma GÖNDERİLMEZ; onay yalnızca
 *      metni kullanıcıya verir.
 */

const LETTER = readFileSync(
  join(__dirname, '../../../test-fixtures/behordenbriefe/01-aufenthaltserlaubnis-verlaengerung.txt'),
  'utf8',
);

const CHANNEL_USER = 'tg-777';

function incoming(partial: Partial<IncomingMessage>): IncomingMessage {
  return {
    channel: 'mock',
    channelUserId: CHANNEL_USER,
    kind: 'text',
    locale: 'tr',
    ...partial,
  } as IncomingMessage;
}

describe('ConversationService — uçtan uca sohbet akışı', () => {
  let app: INestApplication;
  let convo: ConversationService;
  let channel: MockChannelAdapter;

  const ORIGINAL_ENV = process.env;

  beforeEach(async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      LLM_MOCK: 'true',
      DB_DRIVER: 'memory',
      TELEGRAM_MODE: 'disabled',
    };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PII_MASTER_KEY;

    const mock = new MockChannelAdapter();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ConversationModule],
    })
      // Gerçek Telegram yerine mock kanal — gönderilen her şeyi denetleyebilelim.
      .overrideProvider(ChannelAdapter)
      .useValue(mock)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    convo = app.get(ConversationService);
    channel = mock;
  });

  afterEach(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  const allText = () => channel.sentMessages.map((m) => m.text).join('\n---\n');

  /**
   * Karşılaştırma için metni sadeleştirir.
   *
   * Neden gerekli: Türkçe `İ`.toLowerCase() → `i` + U+0307 (birleşen nokta)
   * üretir; düz `toLowerCase()` ile yapılan eşleşmeler bu yüzden sessizce
   * başarısız olur. Ürün metni doğru — sorun karşılaştırmada.
   */
  const normalized = () =>
    allText()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '');

  // ── Onboarding / şeffaflık ────────────────────────────────────────────────
  describe('/start — AI şeffaflığı ve rıza', () => {
    it('yapay zekâ olduğunu ve hukuki tavsiye vermediğini belirtir', async () => {
      await convo.handle(incoming({ kind: 'command', command: 'start' }));

      const text = normalized();
      expect(text).toMatch(/yapay zek|ai\b/);
      expect(text).toMatch(/hukuki tavsiye/);
    });

    it('rıza ister ve kullanıcıyı kaydeder', async () => {
      await convo.handle(incoming({ kind: 'command', command: 'start' }));

      const user = await app
        .get(UserRepository)
        .findByChannel('mock', CHANNEL_USER);
      expect(user).not.toBeNull();
      expect(user?.aiDisclosureAckAt).toBeInstanceOf(Date);
      expect(user?.consentAt).toBeFalsy(); // henüz onay YOK
    });

    it('/onayla rızayı kaydeder', async () => {
      await convo.handle(incoming({ kind: 'command', command: 'start' }));
      await convo.handle(incoming({ kind: 'command', command: 'onayla' }));

      const user = await app
        .get(UserRepository)
        .findByChannel('mock', CHANNEL_USER);
      expect(user?.consentAt).toBeInstanceOf(Date);
    });
  });

  // ── KRİTİK: rıza kapısı ───────────────────────────────────────────────────
  describe('rıza olmadan belge işlenmez (GDPR)', () => {
    it('onaysız gönderilen belge ANALİZ EDİLMEZ', async () => {
      await convo.handle(incoming({ kind: 'text', text: LETTER }));

      // Hiçbir belge kaydı oluşmamalı.
      const user = await app
        .get(UserRepository)
        .findByChannel('mock', CHANNEL_USER);
      const docs = await app.get(DocumentRepository).findByUser(user!.id);
      expect(docs).toHaveLength(0);

      expect(normalized()).toMatch(/onayla/);
    });

    it('onaydan sonra aynı belge işlenir', async () => {
      await convo.handle(incoming({ kind: 'command', command: 'onayla' }));
      await convo.handle(incoming({ kind: 'text', text: LETTER }));

      const user = await app
        .get(UserRepository)
        .findByChannel('mock', CHANNEL_USER);
      const docs = await app.get(DocumentRepository).findByUser(user!.id);
      expect(docs.length).toBeGreaterThan(0);
      expect(docs[0].status).toBe('analyzed');
    });
  });

  // ── Analiz sunumu ─────────────────────────────────────────────────────────
  describe('analiz sonucu sunumu', () => {
    beforeEach(async () => {
      await convo.handle(incoming({ kind: 'command', command: 'onayla' }));
      await convo.handle(incoming({ kind: 'text', text: LETTER }));
    });

    it('kullanıcıya gönderilen mesajda maskeleme token\'ı GÖRÜNMEZ', () => {
      expect(allText()).not.toMatch(/\[\[[A-Z]+_\d+\]\]/);
    });

    it('her analiz mesajında hukuki tavsiye uyarısı bulunur', () => {
      expect(normalized()).toMatch(/hukuki tavsiye vermez/);
    });

    it('eksik belgeler ve sonraki adımlar sunulur', () => {
      const text = allText();
      expect(text).toMatch(/Eksik\/istenen belgeler/i);
    });
  });

  // ── KRİTİK: human-in-the-loop ─────────────────────────────────────────────
  describe('taslak onay akışı — hiçbir şey kullanıcı adına gönderilmez', () => {
    beforeEach(async () => {
      await convo.handle(incoming({ kind: 'command', command: 'onayla' }));
      await convo.handle(incoming({ kind: 'text', text: LETTER }));
      await convo.handle(incoming({ kind: 'command', command: 'taslak' }));
    });

    it('taslak onay butonlarıyla SUNULUR, otomatik onaylanmaz', async () => {
      expect(channel.approvalRequests).toHaveLength(1);

      const draftId = channel.approvalRequests[0].request.draftId;
      const draft = await app.get(DraftRepository).findById(draftId);
      expect(draft?.status).toBe('pending_approval');
      expect(draft?.approvedAt).toBeFalsy();
    });

    it('kullanıcı onaylayınca metin KULLANICIYA verilir (kuruma değil)', async () => {
      const draftId = channel.approvalRequests[0].request.draftId;

      await convo.handle(
        incoming({ kind: 'callback', callbackData: `approve:${draftId}` }),
      );

      const draft = await app.get(DraftRepository).findById(draftId);
      expect(draft?.approvedAt).toBeInstanceOf(Date);

      // Kullanıcıya "kendiniz gönderin" mesajı gitmeli.
      expect(normalized()).toMatch(/kendiniz gonder/);
      // Sistemin kuruma gönderdiğine dair hiçbir iddia olmamalı.
      // Not: `ı` (U+0131) ayrı bir harftir, NFD ile `i`ye inmez — desende kullanma.
      expect(normalized()).toMatch(/hicbir belgeyi sizin ad/);
    });

    it('kullanıcı reddedince taslak "rejected" olur ve gönderilemez', async () => {
      const draftId = channel.approvalRequests[0].request.draftId;

      await convo.handle(
        incoming({ kind: 'callback', callbackData: `reject:${draftId}` }),
      );

      const draft = await app.get(DraftRepository).findById(draftId);
      expect(draft?.status).toBe('rejected');
      expect(draft?.approvedAt).toBeFalsy();
    });

    it('onaylanan taslak metni token içermez (unmask edilmiş)', async () => {
      const draftId = channel.approvalRequests[0].request.draftId;
      await convo.handle(
        incoming({ kind: 'callback', callbackData: `approve:${draftId}` }),
      );
      expect(allText()).not.toMatch(/\[\[[A-Z]+_\d+\]\]/);
    });
  });

  // ── GDPR silme ────────────────────────────────────────────────────────────
  describe('/sil — GDPR Art. 17', () => {
    it('kullanıcının belgelerini ve kaydını siler', async () => {
      await convo.handle(incoming({ kind: 'command', command: 'onayla' }));
      await convo.handle(incoming({ kind: 'text', text: LETTER }));

      const before = await app
        .get(UserRepository)
        .findByChannel('mock', CHANNEL_USER);
      expect(before).not.toBeNull();

      await convo.handle(incoming({ kind: 'command', command: 'sil' }));

      const after = await app
        .get(UserRepository)
        .findByChannel('mock', CHANNEL_USER);
      expect(after).toBeNull();

      const docs = await app.get(DocumentRepository).findByUser(before!.id);
      expect(docs).toHaveLength(0);
    });
  });

  // ── Dayanıklılık ──────────────────────────────────────────────────────────
  describe('dayanıklılık', () => {
    it('bilinmeyen komut çökertmez', async () => {
      await expect(
        convo.handle(incoming({ kind: 'command', command: 'blabla' })),
      ).resolves.not.toThrow();
    });

    it('analiz yokken /taslak çökertmez', async () => {
      await convo.handle(incoming({ kind: 'command', command: 'onayla' }));
      await expect(
        convo.handle(incoming({ kind: 'command', command: 'taslak' })),
      ).resolves.not.toThrow();
      expect(channel.approvalRequests).toHaveLength(0);
    });
  });
});

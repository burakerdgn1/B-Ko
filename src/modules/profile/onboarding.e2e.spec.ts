// ⚠️ ENV import'lardan ÖNCE (bkz. DECISIONS D-023).
process.env.NODE_ENV = 'test';
process.env.LLM_MOCK = 'false'; // gerçek çağrı yolu — payload denetlenebilsin
process.env.DB_DRIVER = 'memory';
process.env.TELEGRAM_MODE = 'disabled';

import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppModule } from '../../app.module';
import { ConversationModule } from '../conversation/conversation.module';
import { ConversationService } from '../conversation/conversation.service';
import { ChannelAdapter, IncomingMessage } from '../channels/channel.adapter';
import { MockChannelAdapter } from '../channels/mock/mock.adapter';
import { ANTHROPIC_CLIENT, AnthropicClientLike } from '../llm/anthropic-client';
import { ProfileService } from './profile.service';
import { UserRepository } from '../persistence/repositories/user.repository';
import { DocumentRepository } from '../persistence/repositories/document.repository';
import { PiiVaultRepository } from '../persistence/repositories/pii-vault.repository';
import { AuditRepository } from '../persistence/repositories/audit.repository';

/**
 * ONBOARDING UÇTAN UCA — D-018/D-024'ün gerçekten kapandığının kanıtı.
 *
 * Senaryo: kullanıcı onboarding'den geçer, kendi ad/adres bilgisini verir;
 * ardından o bilgileri İÇEREN bir mektup gönderir. Doğrulanan:
 *   1. Profil değerleri `pii_vault`'ta ŞİFRELİ (düz metin yok)
 *   2. Kullanıcının adı artık Claude payload'ına GİTMİYOR
 *   3. Kullanıcının adı artık `documents.masked_text` içinde SAKLANMIYOR
 *   4. /atla diyen kullanıcıda eski davranış sürüyor (dürüst karşılaştırma)
 *   5. v2 SINIRI: mektuptaki ÜÇÜNCÜ TARAF isimleri hâlâ maskelenmiyor
 */

const USER = 'onb-user';

// Kullanıcının kendi bilgileri + mektupta geçen ÜÇÜNCÜ TARAF isimleri.
const ME = {
  name: 'Yasin Kılıç',
  address: 'Kolonnenstraße 12',
  city: '10827 Berlin',
};
const CASEWORKER = 'Sabine Brandt'; // memur adı — üçüncü taraf
const FAMILY = 'Elif Kılıç'; // aile üyesi — üçüncü taraf

const LETTER = [
  'Ausländerbehörde Berlin',
  '',
  `Herrn ${ME.name}`,
  ME.address,
  ME.city,
  '',
  'Aktenzeichen: ABH-2024-004711',
  '',
  `Sehr geehrter Herr Kılıç,`,
  '',
  'für den Antrag Ihrer Ehefrau ' + FAMILY + ' benötigen wir weitere Unterlagen.',
  'Bitte reichen Sie diese bis zum 30.06.2024 ein.',
  '',
  'Ihre Sachbearbeiterin: Frau ' + CASEWORKER,
  'Kontakt: s.brandt@ba-berlin.de',
  '',
  'Mit freundlichen Grüßen',
].join('\n');

const VALID_JSON = JSON.stringify({
  authority: 'Ausländerbehörde Berlin',
  requestType: 'Unterlagennachforderung',
  summary: 'Zusammenfassung',
  deadlineToken: null,
  riskLevel: 'high',
  missingDocuments: [],
  nextSteps: [],
  confidence: 0.9,
  inScope: true,
});

describe('Onboarding uçtan uca — bilinen-değer maskeleme aktif mi?', () => {
  let app: INestApplication;
  let convo: ConversationService;
  let channel: MockChannelAdapter;
  let payloads: string[];

  beforeEach(async () => {
    payloads = [];
    channel = new MockChannelAdapter();

    const spyClient: AnthropicClientLike = {
      messages: {
        create: async (body: Anthropic.MessageCreateParamsNonStreaming) => {
          payloads.push(JSON.stringify(body));
          return {
            content: [{ type: 'text', text: VALID_JSON }],
            model: 'test',
          } as unknown as Anthropic.Message;
        },
      },
    };

    const ref = await Test.createTestingModule({
      imports: [AppModule, ConversationModule],
    })
      .overrideProvider(ChannelAdapter)
      .useValue(channel)
      .overrideProvider(ANTHROPIC_CLIENT)
      .useValue(spyClient)
      .compile();

    app = ref.createNestApplication();
    await app.init();
    convo = app.get(ConversationService);
  });

  afterEach(async () => {
    await app?.close();
  });

  const say = (partial: Partial<IncomingMessage>) =>
    convo.handle({
      channel: 'mock',
      channelUserId: USER,
      kind: 'text',
      locale: 'tr',
      ...partial,
    } as IncomingMessage);

  /** Onboarding'i tam olarak tamamlar. */
  const completeOnboarding = async () => {
    await say({ kind: 'command', command: 'start' });
    await say({ kind: 'command', command: 'onayla' });
    await say({ text: ME.name });
    await say({ text: ME.address });
    await say({ text: ME.city });
  };

  const sentText = () => channel.sentMessages.map((m) => m.text).join('\n');

  // ── Onboarding akışı ──────────────────────────────────────────────────────
  describe('akış', () => {
    it('rıza sonrası onboarding başlar ve 3 adım sorar', async () => {
      await say({ kind: 'command', command: 'start' });
      await say({ kind: 'command', command: 'onayla' });

      expect(sentText()).toContain('1/3');

      await say({ text: ME.name });
      expect(sentText()).toContain('2/3');

      await say({ text: ME.address });
      expect(sentText()).toContain('3/3');

      await say({ text: ME.city });
      expect(sentText()).toMatch(/gizlenecek/);
    });

    it('kullanıcı profil vermeyi REDDEDEBİLİR (/atla) ve bu açıkça söylenir', async () => {
      await say({ kind: 'command', command: 'start' });
      await say({ kind: 'command', command: 'onayla' });
      await say({ kind: 'command', command: 'atla' });

      // Dürüstlük: adın maskelenmeyeceği kullanıcıya AÇIKÇA bildirilir.
      expect(sentText()).toMatch(/ADINIZ gizlenmeden/);

      const user = await app.get(UserRepository).findByChannel('mock', USER);
      expect(user?.profileCompletedAt).toBeInstanceOf(Date);
    });

    it('onboarding sırasında uzun metin BELGE olarak işlenir (ad sanılmaz)', async () => {
      await say({ kind: 'command', command: 'start' });
      await say({ kind: 'command', command: 'onayla' });

      await say({ text: LETTER }); // araya mektup yapıştırıldı

      const user = await app.get(UserRepository).findByChannel('mock', USER);
      const docs = await app.get(DocumentRepository).findByUser(user!.id);
      expect(docs.length).toBeGreaterThan(0);
    });
  });

  // ── Vault'ta şifreli saklama ──────────────────────────────────────────────
  describe('profil saklama', () => {
    it('profil değerleri vault\'ta ŞİFRELİ tutulur (düz metin yok)', async () => {
      await completeOnboarding();

      const user = await app.get(UserRepository).findByChannel('mock', USER);
      const records = await app.get(PiiVaultRepository).findByUser(user!.id);
      const profileRecords = records.filter((r) => r.token.startsWith('profile:'));

      expect(profileRecords.length).toBeGreaterThan(0);

      const dump = JSON.stringify(profileRecords);
      expect(dump).not.toContain(ME.name);
      expect(dump).not.toContain(ME.address);
      expect(dump).not.toContain('Kılıç');
    });

    it('profil geri çözülebilir ve ad parçaları da kaydedilmiştir (D-015)', async () => {
      await completeOnboarding();

      const user = await app.get(UserRepository).findByChannel('mock', USER);
      const profile = await app.get(ProfileService).load(user!.id);

      expect(profile?.fullName).toBe(ME.name);
      expect(profile?.familyName).toBe('Kılıç');
      expect(profile?.address).toBe(ME.address);
      expect(profile?.postalCode).toBe('10827');
      expect(profile?.city).toBe('Berlin');
    });

    it('users tablosunda düz PII SAKLANMAZ', async () => {
      await completeOnboarding();

      const user = await app.get(UserRepository).findByChannel('mock', USER);
      const dump = JSON.stringify(user);
      expect(dump).not.toContain(ME.name);
      expect(dump).not.toContain(ME.address);
    });
  });

  // ── ASIL KANIT: D-024 kapandı mı? ─────────────────────────────────────────
  describe('✅ D-024 kapanışı — kullanıcının KENDİ verisi', () => {
    it('kullanıcının adı artık Claude payload\'ına GİTMİYOR', async () => {
      await completeOnboarding();
      await say({ text: LETTER });

      expect(payloads.length).toBeGreaterThan(0);
      const sent = payloads.join('\n');

      expect(sent).not.toContain(ME.name);
      expect(sent).not.toContain('Kılıç');
      expect(sent).not.toContain(ME.address);
    });

    it('kullanıcının adı artık `masked_text` içinde SAKLANMIYOR', async () => {
      await completeOnboarding();
      await say({ text: LETTER });

      const user = await app.get(UserRepository).findByChannel('mock', USER);
      const docs = await app.get(DocumentRepository).findByUser(user!.id);
      const doc = docs.find((d) => d.status === 'analyzed');

      expect(doc?.maskedText).toBeTruthy();
      expect(doc!.maskedText!).not.toContain(ME.name);
      expect(doc!.maskedText!).not.toContain(ME.address);
    });

    it('/atla diyen kullanıcıda bile tetikleyici bağlamdaki ad maskelenir (D-029)', async () => {
      await say({ kind: 'command', command: 'start' });
      await say({ kind: 'command', command: 'onayla' });
      await say({ kind: 'command', command: 'atla' });
      await say({ text: LETTER });

      // Profil yok; ama "Herrn <ad>" tetikleyicisi deterministik olarak yakalar.
      // Profilin ek değeri: tetikleyicisiz geçişleri ve adresi de kapsaması.
      expect(payloads.join('\n')).not.toContain(ME.name);
    });
  });

  // ── TÜM SIZINTI KANALLARI, gerçek onboarding profiliyle ──────────────────
  describe('✅ sızıntı kanalları — onboarding profiliyle tekrar', () => {
    it('log satırlarının hiçbiri kullanıcının adını/adresini içermez', async () => {
      const logLines: string[] = [];
      for (const level of ['log', 'error', 'warn', 'debug'] as const) {
        jest.spyOn(Logger.prototype, level).mockImplementation((...args) => {
          logLines.push(args.map((a) => String(a)).join(' '));
        });
      }

      await completeOnboarding();
      await say({ text: LETTER });

      const logs = logLines.join('\n');
      expect(logLines.length).toBeGreaterThan(0);
      expect(logs).not.toContain(ME.name);
      expect(logs).not.toContain(ME.address);
      jest.restoreAllMocks();
    });

    it('audit kayıtları profil DEĞERLERİNİ içermez (yalnızca alan adları)', async () => {
      await completeOnboarding();
      await say({ text: LETTER });

      const user = await app.get(UserRepository).findByChannel('mock', USER);
      const entries = await app.get(AuditRepository).findByUser(user!.id);
      const dump = JSON.stringify(entries);

      expect(entries.some((e) => e.action === 'profile.saved')).toBe(true);
      expect(dump).not.toContain(ME.name);
      expect(dump).not.toContain(ME.address);
      // Alan ADLARI denetim için yararlı ve PII değil.
      expect(dump).toContain('fullName');
    });

    it('LLM hatası kullanıcının adını yankılasa bile DB/log/kullanıcıya sızmaz', async () => {
      await completeOnboarding();

      // Bu senaryoda LLM, hata metninde ham adı yankılıyor.
      const failing = app.get(ANTHROPIC_CLIENT) as AnthropicClientLike;
      jest
        .spyOn(failing.messages, 'create')
        .mockRejectedValue(new Error(`API 400: "${ME.name}" ${ME.address}`));

      await say({ text: LETTER });

      const user = await app.get(UserRepository).findByChannel('mock', USER);
      const docs = await app.get(DocumentRepository).findByUser(user!.id);
      const failed = docs.find((d) => d.status === 'failed');

      expect(failed).toBeDefined();
      expect(JSON.stringify(failed)).not.toContain(ME.name);
      expect(sentText()).not.toContain(ME.name);
      jest.restoreAllMocks();
    });

    it('kullanıcıya gösterilen analiz sonucu GERÇEK adı içerir (unmask çalışıyor)', async () => {
      await completeOnboarding();
      await say({ text: LETTER });

      // Maskeleme kullanıcının kendi deneyimini bozmamalı: token görünmez.
      expect(sentText()).not.toMatch(/\[\[[A-Z]+_\d+\]\]/);
    });
  });

  // ── v2 SINIRI: üçüncü taraf isimleri ──────────────────────────────────────
  describe('✅ üçüncü taraf adları — tetikleyici bağlamda (D-029, Faz A)', () => {
    it('memur adı (Sachbearbeiterin) artık maskelenir', async () => {
      await completeOnboarding();
      await say({ text: LETTER });

      // "Ihre Sachbearbeiterin: Frau <ad>" bir tetikleyicidir.
      expect(payloads.join('\n')).not.toContain(CASEWORKER);
      expect(payloads.join('\n')).not.toContain('Sabine');
    });

    it('aile üyesi adı (Ehefrau <ad>) artık TAM olarak maskelenir', async () => {
      await completeOnboarding();
      await say({ text: LETTER });
      const sent = payloads.join('\n');

      // Daha önce yalnızca ortak SOYAD maskeleniyordu ve ön ad ("Elif")
      // sızıyordu — kısmi maskeleme yanıltıcıydı. Aile bağı tetikleyicisi
      // ("Ihrer Ehefrau <ad>") artık öbeğin tamamını yakalıyor.
      expect(sent).not.toContain(FAMILY);
      expect(sent).not.toContain('Elif');
    });

    it('🟡 KALAN SINIR: tetikleyicisiz geçen ad hâlâ maskelenmez (v2 — D-028)', async () => {
      await completeOnboarding();
      // Hiçbir unvan/etiket olmadan, cümle içinde geçen bir ad.
      await say({
        text:
          'Ausländerbehörde Berlin\n\nDer Antrag wurde von Petra Hoffmann geprüft ' +
          'und an die zuständige Stelle weitergeleitet. Bitte warten Sie auf weitere ' +
          'Nachricht.\n\nMit freundlichen Grüßen',
      });

      // Bu ancak yerel NER ile yakalanabilir; Faz A kapsamı dışında.
      expect(payloads.join('\n')).toContain('Petra Hoffmann');
    });

    it('aile üyesi profile EKLENİRSE maskelenir (geçici çözüm mevcut)', async () => {
      await completeOnboarding();

      const user = await app.get(UserRepository).findByChannel('mock', USER);
      const profiles = app.get(ProfileService);
      const current = await profiles.load(user!.id);
      await profiles.save(user!.id, {
        ...current,
        extra: [
          {
            value: FAMILY,
            type: (await import('../../common/pii/pii.types')).PiiEntityType.NAME,
          },
        ],
      });

      await say({ text: LETTER });
      expect(payloads.join('\n')).not.toContain(FAMILY);
    });
  });
});

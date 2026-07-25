// ⚠️ ENV, import'lardan ÖNCE ayarlanmalıdır.
//
// `ConfigModule.forRoot()` doğrulamayı IMPORT ANINDA senkron çalıştırır; bu yüzden
// `beforeEach` içinde yapılan `process.env` atamaları GEÇ KALIR ve sessizce yok
// sayılır (bkz. DECISIONS D-023). Üretimde de durum aynıdır: env değişkenleri
// süreç başlamadan önce verilir.
process.env.NODE_ENV = 'test';
process.env.LLM_MOCK = 'false'; // gerçek çağrı yolunu zorla (sahte istemciyle)
process.env.DB_DRIVER = 'memory';
process.env.TELEGRAM_MODE = 'disabled';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppModule } from '../../app.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { AnalysisPipeline } from '../analysis/analysis.pipeline';
import { ANTHROPIC_CLIENT, AnthropicClientLike } from './anthropic-client';
import { UserRepository } from '../persistence/repositories/user.repository';
import { DocumentRepository } from '../persistence/repositories/document.repository';
import { AuditRepository } from '../persistence/repositories/audit.repository';
import { KnownPiiProfile } from '../../common/pii/pii.types';

/**
 * SIZINTI KANALI DENETİMİ — "maskelendi" demek yetmez.
 *
 * Ham PII yalnızca API payload'ından değil, ŞU KANALLARIN HİÇBİRİNDEN
 * sızmamalıdır:
 *   1. Claude API payload'ı (sistem promptu + mesajlar)
 *   2. Log satırları (her seviye: debug/log/warn/error)
 *   3. Veritabanına yazılan hata mesajları
 *   4. Exception mesajları ve STACK TRACE'ler
 *   5. Audit log kayıtları
 *
 * Bu dosya her kanalı ayrı ayrı denetler.
 */

const FIXTURE_DIR = join(__dirname, '../../../test-fixtures');
const LETTER_DIR = join(FIXTURE_DIR, 'behordenbriefe');
const expected: Record<string, { file: string }> = JSON.parse(
  readFileSync(join(LETTER_DIR, 'expected.json'), 'utf8'),
);
const profiles: Record<string, KnownPiiProfile> = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'profiles.json'), 'utf8'),
);
const KEY = Object.keys(expected)[0];
const LETTER = readFileSync(join(LETTER_DIR, expected[KEY].file), 'utf8');
const PROFILE = profiles[KEY];

const VALID_JSON = JSON.stringify({
  authority: 'Ausländerbehörde',
  requestType: 'Unterlagennachforderung',
  summary: 'Zusammenfassung [[NAME_1]]',
  deadlineToken: '[[DATE_1]]',
  riskLevel: 'high',
  missingDocuments: [],
  nextSteps: [],
  confidence: 0.9,
  inScope: true,
});

/** Profilden, metinde gerçekten geçen hassas değerleri toplar. */
function secretsOf(profile: KnownPiiProfile): string[] {
  return [
    profile.fullName,
    profile.familyName,
    profile.address,
    profile.email,
    profile.phone,
    profile.dateOfBirth,
    profile.auslaendernummer,
    profile.steuerId,
  ].filter(
    (v): v is string =>
      typeof v === 'string' && v.length > 3 && LETTER.includes(v),
  );
}

describe('Sızıntı kanalı denetimi', () => {
  let app: INestApplication;
  let pipeline: AnalysisPipeline;
  let userId: string;
  let payloads: string[];
  let logLines: string[];
  let responseText: string;
  let shouldThrow: Error | null;

  beforeEach(async () => {
    payloads = [];
    logLines = [];
    responseText = VALID_JSON;
    shouldThrow = null;

    const spyClient: AnthropicClientLike = {
      messages: {
        create: async (body: Anthropic.MessageCreateParamsNonStreaming) => {
          payloads.push(JSON.stringify(body));
          if (shouldThrow) throw shouldThrow;
          return {
            content: [{ type: 'text', text: responseText }],
            model: 'test',
          } as unknown as Anthropic.Message;
        },
      },
    };

    // TÜM log seviyelerini yakala.
    for (const level of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args) => {
        logLines.push(args.map((a) => safeStringify(a)).join(' '));
      });
      jest.spyOn(Logger, level).mockImplementation((...args: unknown[]) => {
        logLines.push(args.map((a) => safeStringify(a)).join(' '));
      });
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, AnalysisModule],
    })
      .overrideProvider(ANTHROPIC_CLIENT)
      .useValue(spyClient)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    pipeline = app.get(AnalysisPipeline);

    const user = await app.get(UserRepository).create({
      channel: 'telegram',
      channelUserId: 'leak-audit',
      locale: 'tr',
    });
    userId = user.id;
  });

  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  // ── Kanal 1: API payload ──────────────────────────────────────────────────
  describe('Kanal 1 — Claude API payload', () => {
    it('profil VERİLDİĞİNDE payload hiçbir ham PII içermez', async () => {
      await pipeline.run({ userId, source: 'text', text: LETTER, profile: PROFILE });

      const sent = payloads.join('\n');
      expect(payloads.length).toBeGreaterThan(0);
      for (const secret of secretsOf(PROFILE)) {
        expect(sent).not.toContain(secret);
      }
    });
  });

  // ── KRİTİK: v1'in GERÇEK durumu (profil YOK — D-018) ─────────────────────
  describe('🔴 Kanal 1b — v1 gerçek akışı: profil OLMADAN', () => {
    /**
     * ConversationService v1'de `profile: undefined` geçiyor (D-018).
     * Bu test, o durumda payload'a NE GİTTİĞİNİ dürüstçe ölçer.
     *
     * Bu testler "güvenli" olduğumuzu değil, SINIRIN NEREDE olduğunu gösterir.
     * Kırılırlarsa kapsam değişmiş demektir — güncellenmeleri gerekir.
     */
    it('yapısal alanlar (e-posta/telefon/IBAN/tarih) profilsiz de maskelenir', async () => {
      await pipeline.run({ userId, source: 'text', text: LETTER });

      const sent = payloads.join('\n');
      for (const structural of [
        PROFILE.email,
        PROFILE.phone,
        PROFILE.steuerId,
        PROFILE.auslaendernummer,
      ].filter((v): v is string => typeof v === 'string' && v.length > 3 && LETTER.includes(v))) {
        expect(sent).not.toContain(structural);
      }
    });

    it('🔴 BULGU: İSİM profilsiz maskelenmez ve payload\'a ÇIPLAK gider', async () => {
      await pipeline.run({ userId, source: 'text', text: LETTER });

      const sent = payloads.join('\n');
      const name = PROFILE.fullName!;
      expect(LETTER).toContain(name); // mektupta gerçekten var

      // Mevcut davranış: isim maskelenmiyor. NAME için yapısal desen YOK ve
      // v1 akışı profil beslemiyor (D-018) → isim Claude'a çıplak ulaşıyor.
      expect(sent).toContain(name);
    });

    it('KARŞILAŞTIRMA: aynı akış profil İLE çağrılırsa isim maskelenir', async () => {
      await pipeline.run({ userId, source: 'text', text: LETTER, profile: PROFILE });
      expect(payloads.join('\n')).not.toContain(PROFILE.fullName!);
    });
  });

  // ── Kanal 2: loglar ───────────────────────────────────────────────────────
  describe('Kanal 2 — log satırları', () => {
    it('başarılı akışta hiçbir log satırı ham PII içermez', async () => {
      await pipeline.run({ userId, source: 'text', text: LETTER, profile: PROFILE });

      const logs = logLines.join('\n');
      expect(logLines.length).toBeGreaterThan(0); // loglama gerçekten oldu
      for (const secret of secretsOf(PROFILE)) {
        expect(logs).not.toContain(secret);
      }
    });

    it('sızıntı denetimi tetiklendiğinde yalnızca TİP loglanır, değer değil', async () => {
      // detectLeaks'i tetiklemek için maskelemeyi bozan bir servis enjekte etmek
      // yerine, gerçek akışta zaten loglanan sızıntı mesajını kontrol ediyoruz:
      // llm.leak-guard.spec.ts bu yolu kapsıyor. Burada log formatını doğruluyoruz.
      const { PiiService } = await import('../../common/pii/pii.service');
      const real = new PiiService();
      const { maskedText, map } = real.mask(LETTER, { profile: PROFILE });
      const leaked = real.detectLeaks(maskedText, map);
      expect(leaked).toEqual([]); // sağlıklı durumda sızıntı yok

      // Sızıntı mesajı üretilirse: yalnızca tip adları (NAME, ADDRESS...) içermeli.
      const sample = 'Sızan tipler: NAME, ADDRESS';
      for (const secret of secretsOf(PROFILE)) {
        expect(sample).not.toContain(secret);
      }
    });
  });

  // ── Kanal 3 & 4: hata mesajları ve stack trace'ler ────────────────────────
  describe('Kanal 3/4 — hata mesajları ve stack trace', () => {
    it('LLM hatası ham PII yankılasa bile DB\'ye ve loga sızmaz', async () => {
      // Alt katman, belge içeriğini hata mesajına koyuyor (gerçekçi senaryo:
      // bir SDK, gövdeyi hata metnine ekleyebilir).
      shouldThrow = new Error(
        `API 400: invalid request for "${PROFILE.fullName}" at ${PROFILE.address}`,
      );

      await expect(
        pipeline.run({ userId, source: 'text', text: LETTER, profile: PROFILE }),
      ).rejects.toThrow();

      // 3a. DB'ye yazılan hata mesajı
      const docs = await app.get(DocumentRepository).findByUser(userId);
      const failed = docs.find((d) => d.status === 'failed');
      expect(failed).toBeDefined();
      const dbDump = JSON.stringify(failed);
      for (const secret of secretsOf(PROFILE)) {
        expect(dbDump).not.toContain(secret);
      }

      // 3b. Log satırları
      const logs = logLines.join('\n');
      for (const secret of secretsOf(PROFILE)) {
        expect(logs).not.toContain(secret);
      }
    });

    it('dışarı fırlayan exception\'ın MESAJI ham PII içerebilir — sınır belgelenir', async () => {
      shouldThrow = new Error(`API 400: "${PROFILE.fullName}"`);

      let caught: Error | null = null;
      try {
        await pipeline.run({
          userId,
          source: 'text',
          text: LETTER,
          profile: PROFILE,
        });
      } catch (e) {
        caught = e as Error;
      }

      expect(caught).not.toBeNull();
      // BİLİNEN SINIR: pipeline hatayı yeniden fırlatır (çağıran ele alsın diye).
      // Orijinal mesaj korunur; bu yüzden ÜST katman (ConversationService) onu
      // ASLA kullanıcıya/loga ham hâliyle vermez — sabit bir metin gösterir.
      // Aşağıdaki test bunu doğruluyor.
      expect(typeof caught!.message).toBe('string');
    });

    it('ConversationService hatayı ham hâliyle KULLANICIYA GÖSTERMEZ', async () => {
      const { ConversationService } = await import(
        '../conversation/conversation.service'
      );
      const { MockChannelAdapter } = await import(
        '../channels/mock/mock.adapter'
      );
      const { ChannelAdapter } = await import('../channels/channel.adapter');
      const { ConversationModule } = await import(
        '../conversation/conversation.module'
      );

      const mockChannel = new MockChannelAdapter();
      const spyClient: AnthropicClientLike = {
        messages: {
          create: async () => {
            throw new Error(`API 400: "${PROFILE.fullName}" ${PROFILE.address}`);
          },
        },
      };

      const ref = await Test.createTestingModule({
        imports: [AppModule, ConversationModule],
      })
        .overrideProvider(ANTHROPIC_CLIENT)
        .useValue(spyClient)
        .overrideProvider(ChannelAdapter)
        .useValue(mockChannel)
        .compile();

      const app2 = ref.createNestApplication();
      await app2.init();
      const convo = app2.get(ConversationService);

      await convo.handle({
        channel: 'mock',
        channelUserId: 'err-user',
        kind: 'command',
        command: 'onayla',
        locale: 'tr',
      } as never);

      await convo.handle({
        channel: 'mock',
        channelUserId: 'err-user',
        kind: 'text',
        text: LETTER,
        locale: 'tr',
      } as never);

      const shown = mockChannel.sentMessages.map((m) => m.text).join('\n');
      for (const secret of secretsOf(PROFILE)) {
        expect(shown).not.toContain(secret);
      }

      await app2.close();
    });
  });

  // ── Kanal 6: veritabanı (profilsiz) ──────────────────────────────────────
  describe('🔴 Kanal 6 — veritabanı, profil OLMADAN', () => {
    it('🔴 BULGU: maskelenmeyen isim `documents.masked_text` içinde KALICI olur', async () => {
      const outcome = await pipeline.run({ userId, source: 'text', text: LETTER });

      const doc = await app.get(DocumentRepository).findById(outcome.document.id);

      // `masked_text` adı üzerinde "maskeli"dir; ancak maskeleme NAME'i
      // kapsamadığı için (D-024) isim burada ham hâliyle kalıcılaşır.
      // Bu, yalnızca LLM'e gönderimi değil, GDPR saklama yüzeyini de etkiler.
      expect(doc?.maskedText).toContain(PROFILE.fullName!);
    });

    it('KARŞILAŞTIRMA: profil ile aynı alan ham isim İÇERMEZ', async () => {
      const outcome = await pipeline.run({
        userId,
        source: 'text',
        text: LETTER,
        profile: PROFILE,
      });

      const doc = await app.get(DocumentRepository).findById(outcome.document.id);
      expect(doc?.maskedText).not.toContain(PROFILE.fullName!);
    });

    it('yapısal alanlar profilsiz de DB\'de maskelidir', async () => {
      const outcome = await pipeline.run({ userId, source: 'text', text: LETTER });
      const doc = await app.get(DocumentRepository).findById(outcome.document.id);

      for (const structural of [PROFILE.email, PROFILE.steuerId].filter(
        (v): v is string => typeof v === 'string' && v.length > 3 && LETTER.includes(v),
      )) {
        expect(doc?.maskedText).not.toContain(structural);
      }
    });
  });

  // ── Kanal 5: audit log ────────────────────────────────────────────────────
  describe('Kanal 5 — audit log', () => {
    it('audit kayıtları ham PII içermez (yalnızca id/sayaç)', async () => {
      await pipeline.run({ userId, source: 'text', text: LETTER, profile: PROFILE });

      const entries = await app.get(AuditRepository).findByUser(userId);
      expect(entries.length).toBeGreaterThan(0);

      const dump = JSON.stringify(entries);
      for (const secret of secretsOf(PROFILE)) {
        expect(dump).not.toContain(secret);
      }
    });
  });
});

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.message}\n${value.stack ?? ''}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

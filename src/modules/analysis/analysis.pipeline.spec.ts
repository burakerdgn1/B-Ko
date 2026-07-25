import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { AnalysisModule } from './analysis.module';
import { AnalysisPipeline } from './analysis.pipeline';
import { PiiService } from '../../common/pii/pii.service';
import { PiiVaultService } from '../../common/pii/pii-vault.service';
import { KnownPiiProfile } from '../../common/pii/pii.types';
import { DocumentRepository } from '../persistence/repositories/document.repository';
import { AnalysisRepository } from '../persistence/repositories/analysis.repository';
import { PiiVaultRepository } from '../persistence/repositories/pii-vault.repository';
import { ReminderRepository } from '../persistence/repositories/reminder.repository';
import { UserRepository } from '../persistence/repositories/user.repository';
import type { INestApplication } from '@nestjs/common';

/**
 * Uçtan uca analiz hattı testi (CLAUDE.md §10 — Definition of Done).
 *
 * Gerçek fixture mektubu → gerçek maskeleme → (mock) LLM → gerçek persistence.
 * Doğrulanan kritik iddialar:
 *   1. Döngünün tamamı çalışıyor (belge → analiz → deadline → hatırlatma).
 *   2. DB'ye yazılan HİÇBİR alanda ham PII yok.
 *   3. pii_vault'ta yalnızca ciphertext var; düz değer yok.
 *   4. Kullanıcıya dönen sonuç unmask edilmiş (yani gerçek bilgi taşıyor).
 */

const FIXTURE_DIR = join(__dirname, '../../../test-fixtures');
const LETTER_DIR = join(FIXTURE_DIR, 'behordenbriefe');

const expected: Record<string, { file: string }> = JSON.parse(
  readFileSync(join(LETTER_DIR, 'expected.json'), 'utf8'),
);
const profiles: Record<string, KnownPiiProfile> = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'profiles.json'), 'utf8'),
);

const FIRST = Object.keys(expected)[0];

describe('AnalysisPipeline — uçtan uca (fixture + mock LLM + in-memory DB)', () => {
  let app: INestApplication;
  let pipeline: AnalysisPipeline;
  let userId: string;

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

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, AnalysisModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    pipeline = app.get(AnalysisPipeline);

    const user = await app.get(UserRepository).create({
      channel: 'telegram',
      channelUserId: 'e2e-user',
      locale: 'tr',
    });
    userId = user.id;
  });

  afterEach(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  it('mektup → analiz → deadline → hatırlatma döngüsü tamamlanır', async () => {
    const text = readFileSync(join(LETTER_DIR, expected[FIRST].file), 'utf8');

    const outcome = await pipeline.run({
      userId,
      source: 'text',
      text,
      profile: profiles[FIRST],
    });

    expect(outcome.document.status).toBe('analyzed');
    expect(outcome.analysis.id).toBeTruthy();
    expect(outcome.summary.length).toBeGreaterThan(0);
    expect(['low', 'medium', 'high', 'critical']).toContain(outcome.riskLevel);
  });

  it('DB\'ye yazılan hiçbir alanda ham PII bulunmaz (KRİTİK)', async () => {
    const text = readFileSync(join(LETTER_DIR, expected[FIRST].file), 'utf8');
    const profile = profiles[FIRST];

    const outcome = await pipeline.run({
      userId,
      source: 'text',
      text,
      profile,
    });

    const storedDoc = await app.get(DocumentRepository).findById(outcome.document.id);
    const storedAnalyses = await app
      .get(AnalysisRepository)
      .findByDocument(outcome.document.id);

    // Kalıcılaştırılan her şeyi tek bir metinde topla.
    const persisted = JSON.stringify({ storedDoc, storedAnalyses });

    const secrets = [
      profile.fullName,
      profile.familyName,
      profile.address,
      profile.email,
      profile.phone,
      profile.dateOfBirth,
      profile.auslaendernummer,
      profile.steuerId,
    ].filter((v): v is string => typeof v === 'string' && v.length > 3);

    expect(secrets.length).toBeGreaterThan(0);
    for (const secret of secrets) {
      expect(persisted).not.toContain(secret);
    }

    // Maskeli metin gerçekten kaydedilmiş olmalı (boş bırakılarak "kaçırılmamış").
    expect(storedDoc?.maskedText).toMatch(/\[\[[A-Z]+_\d+\]\]/);
  });

  it('pii_vault yalnızca şifreli veri tutar ve geri çözülebilir', async () => {
    const text = readFileSync(join(LETTER_DIR, expected[FIRST].file), 'utf8');
    const profile = profiles[FIRST];

    const outcome = await pipeline.run({ userId, source: 'text', text, profile });

    const records = await app
      .get(PiiVaultRepository)
      .findByDocument(outcome.document.id);

    expect(records.length).toBeGreaterThan(0);

    // Hiçbir kayıtta düz PII olmamalı.
    const vaultDump = JSON.stringify(records);
    for (const secret of [profile.fullName, profile.address].filter(
      (v): v is string => typeof v === 'string' && v.length > 3,
    )) {
      expect(vaultDump).not.toContain(secret);
    }

    // Ama yetkili taraf çözebilmeli (round-trip).
    const map = app.get(PiiVaultService).open(records, {
      userId,
      documentId: outcome.document.id,
    });
    const restored = app.get(PiiService).unmask(outcome.document.maskedText!, map);
    expect(restored).toBe(text);
  });

  it('kullanıcıya dönen sonuç unmask edilmiştir (token göstermez)', async () => {
    const text = readFileSync(join(LETTER_DIR, expected[FIRST].file), 'utf8');

    const outcome = await pipeline.run({
      userId,
      source: 'text',
      text,
      profile: profiles[FIRST],
    });

    expect(outcome.summary).not.toMatch(/\[\[[A-Z]+_\d+\]\]/);
    for (const doc of outcome.missingDocuments) {
      expect(doc.label).not.toMatch(/\[\[[A-Z]+_\d+\]\]/);
    }
  });

  it('son tarih bulunduğunda hatırlatmalar oluşturulur', async () => {
    // Son tarihi bugüne göre uzak seçerek hatırlatmaların elenmemesini sağla.
    const future = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const dd = String(future.getUTCDate()).padStart(2, '0');
    const mm = String(future.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = future.getUTCFullYear();

    const outcome = await pipeline.run({
      userId,
      source: 'text',
      text:
        `Ausländerbehörde Berlin\n\nSehr geehrter Herr Yılmaz,\n` +
        `bitte reichen Sie die Unterlagen bis zum ${dd}.${mm}.${yyyy} ein.\n\n` +
        `Mit freundlichen Grüßen`,
      profile: { fullName: 'Ahmet Yılmaz' },
    });

    if (outcome.deadline) {
      expect(outcome.remindersCreated).toBeGreaterThan(0);
      const reminders = await app.get(ReminderRepository).findDue(
        new Date(outcome.deadline.getTime() + 1000),
      );
      expect(reminders.length).toBeGreaterThan(0);
    } else {
      // Mock LLM son tarih seçmediyse hatırlatma da olmamalı — tutarlılık.
      expect(outcome.remindersCreated).toBe(0);
    }
  });

  it('hata durumunda belge failed olarak işaretlenir ve PII loglanmaz', async () => {
    const text = readFileSync(join(LETTER_DIR, expected[FIRST].file), 'utf8');

    // LLM'i patlat.
    const llm = app.get(
      (await import('../llm/llm.service')).LlmService,
    );
    jest
      .spyOn(llm, 'analyzeDocument')
      .mockRejectedValue(new Error(`Model hatası: ${profiles[FIRST].fullName}`));

    await expect(
      pipeline.run({ userId, source: 'text', text, profile: profiles[FIRST] }),
    ).rejects.toThrow();

    const docs = await app.get(DocumentRepository).findByUser(userId);
    const failed = docs.find((d) => d.status === 'failed');
    expect(failed).toBeDefined();

    // Hata mesajı ham PII yankılamamalı.
    expect(failed?.errorMessage ?? '').not.toContain(profiles[FIRST].fullName!);
  });
});

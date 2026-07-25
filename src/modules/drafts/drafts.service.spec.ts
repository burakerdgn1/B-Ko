import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { KnownPiiProfile } from '../../common/pii/pii.types';
import { AnalysisModule } from '../analysis/analysis.module';
import { AnalysisPipeline } from '../analysis/analysis.pipeline';
import { DraftRepository } from '../persistence/repositories/draft.repository';
import { UserRepository } from '../persistence/repositories/user.repository';
import { DraftsModule } from './drafts.module';
import { DraftsService } from './drafts.service';

/**
 * `DraftsService` testleri — gerçek fixture mektubu → gerçek maskeleme →
 * (mock) analiz → (mock) taslak üretimi → onay durum makinesi.
 *
 * Doğrulanan kritik iddialar (görev talimatı):
 *   1. `generateForAnalysis` taslağı 'draft' durumunda üretir, ASLA otomatik
 *      onaylamaz/göndermez.
 *   2. DB'ye yazılan taslak içeriğinde (content/subject) HİÇBİR ham PII yok.
 *   3. `getUnmaskedContent` gerçek değerleri döndürür (vault round-trip).
 *   4. Onay kapısı (D-014): yalnızca `approve()` 'approved' üretir;
 *      `markSent` onaysız taslakta HATA fırlatır; `approve` sonrası başarılı olur.
 *   5. `reject()` → 'rejected', ve reddedilmiş taslak asla gönderilemez.
 */

const FIXTURE_DIR = join(__dirname, '../../../test-fixtures');
const LETTER_DIR = join(FIXTURE_DIR, 'behordenbriefe');

const expected: Record<string, { file: string }> = JSON.parse(
  readFileSync(join(LETTER_DIR, 'expected.json'), 'utf8'),
);
const profiles: Record<string, KnownPiiProfile> = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'profiles.json'), 'utf8'),
);

const FIXTURE_KEY = '01-aufenthaltserlaubnis-verlaengerung';
const profile = profiles[FIXTURE_KEY];
const letterText = readFileSync(join(LETTER_DIR, expected[FIXTURE_KEY].file), 'utf8');

/** Fixture profilindeki, DB dökümünde ASLA görünmemesi gereken ham değerler. */
const secrets = [
  profile.fullName,
  profile.address,
  profile.email,
  profile.phone,
  profile.dateOfBirth,
  profile.auslaendernummer,
  profile.steuerId,
].filter((v): v is string => typeof v === 'string' && v.length > 3);

describe('DraftsService (fixture + mock LLM + in-memory DB)', () => {
  let app: INestApplication;
  let draftsService: DraftsService;
  let draftRepo: DraftRepository;
  let userId: string;
  let analysisId: string;

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
      imports: [AppModule, AnalysisModule, DraftsModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    draftsService = app.get(DraftsService);
    draftRepo = app.get(DraftRepository);

    const user = await app.get(UserRepository).create({
      channel: 'telegram',
      channelUserId: 'drafts-e2e-user',
      locale: 'tr',
    });
    userId = user.id;

    // Taslak üretiminin girdisi olacak gerçek bir analiz üret (gerçek fixture
    // mektubu + gerçek maskeleme + mock LLM). analysis.pipeline.spec.ts'teki
    // desenle aynı.
    const outcome = await app.get(AnalysisPipeline).run({
      userId,
      source: 'text',
      text: letterText,
      profile,
    });
    analysisId = outcome.analysis.id;
  });

  afterEach(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  it('generateForAnalysis taslağı "draft" durumunda üretir (asla otomatik onaylamaz)', async () => {
    const { draft } = await draftsService.generateForAnalysis({ analysisId, userId });

    expect(draft.id).toBeTruthy();
    expect(draft.status).toBe('draft');
    expect(draft.approvedAt).toBeNull();
    expect(draft.sentAt).toBeNull();
  });

  it('DB\'ye yazılan taslak içeriğinde hiçbir ham PII bulunmaz (KRİTİK)', async () => {
    const { draft } = await draftsService.generateForAnalysis({ analysisId, userId });

    const stored = await draftRepo.findById(draft.id);
    const persisted = JSON.stringify(stored);

    expect(secrets.length).toBeGreaterThan(0);
    for (const secret of secrets) {
      expect(persisted).not.toContain(secret);
    }

    // Taslak gövdesinde en az bir yer tutucu bulunmalı (maskeleme "kaçırılmamış").
    expect(stored?.content ?? '').toMatch(/\[\[[A-Z]+_\d+\]\]/);
  });

  it('getUnmaskedContent gerçek değerleri döndürür (vault round-trip)', async () => {
    const outcome = await draftsService.generateForAnalysis({ analysisId, userId });

    const fetched = await draftsService.getUnmaskedContent(outcome.draft.id);

    expect(fetched).not.toMatch(/\[\[[A-Z]+_\d+\]\]/);
    // generateForAnalysis'in döndürdüğü unmask edilmiş içerikle birebir aynı olmalı.
    expect(fetched).toBe(outcome.unmaskedContent);
  });

  it('presentForApproval "draft" durumundaki taslağı "pending_approval" yapar', async () => {
    const { draft } = await draftsService.generateForAnalysis({ analysisId, userId });

    const presented = await draftsService.presentForApproval(draft.id);

    expect(presented.status).toBe('pending_approval');
  });

  it('approve "approved" + approvedAt dolu üretir', async () => {
    const { draft } = await draftsService.generateForAnalysis({ analysisId, userId });

    const approved = await draftsService.approve(draft.id, userId);

    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).toBeInstanceOf(Date);
  });

  it('markSent onaysız taslakta HATA fırlatır (KRİTİK, D-014)', async () => {
    const { draft } = await draftsService.generateForAnalysis({ analysisId, userId });

    await expect(draftsService.markSent(draft.id)).rejects.toThrow();

    const stillNotSent = await draftRepo.findById(draft.id);
    expect(stillNotSent?.status).not.toBe('sent');
  });

  it('approve sonrası markSent başarılı olur', async () => {
    const { draft } = await draftsService.generateForAnalysis({ analysisId, userId });

    await draftsService.approve(draft.id, userId);
    const sent = await draftsService.markSent(draft.id);

    expect(sent.status).toBe('sent');
    expect(sent.sentAt).toBeInstanceOf(Date);
  });

  it('reject "rejected" + rejectedAt üretir; reddedilen taslak gönderilemez', async () => {
    const { draft } = await draftsService.generateForAnalysis({ analysisId, userId });

    const rejected = await draftsService.reject(draft.id, userId, 'Kullanıcı vazgeçti');

    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectedAt).toBeInstanceOf(Date);

    await expect(draftsService.markSent(draft.id)).rejects.toThrow();
  });

  it('approve() yalnızca bu metot "approved" üretir — reddedilmiş bir taslak yeniden onaylanamaz', async () => {
    const { draft } = await draftsService.generateForAnalysis({ analysisId, userId });

    await draftsService.reject(draft.id, userId);

    await expect(draftsService.approve(draft.id, userId)).rejects.toThrow();
  });
});

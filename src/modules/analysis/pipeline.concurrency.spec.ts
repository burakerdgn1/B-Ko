// ⚠️ ENV import'lardan ÖNCE (bkz. DECISIONS D-023).
process.env.NODE_ENV = 'test';
process.env.LLM_MOCK = 'true';
process.env.DB_DRIVER = 'memory';
process.env.TELEGRAM_MODE = 'disabled';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { AnalysisModule } from './analysis.module';
import { AnalysisPipeline } from './analysis.pipeline';
import { PiiService } from '../../common/pii/pii.service';
import { PiiVaultService } from '../../common/pii/pii-vault.service';
import { UserRepository } from '../persistence/repositories/user.repository';
import { DocumentRepository } from '../persistence/repositories/document.repository';
import { PiiVaultRepository } from '../persistence/repositories/pii-vault.repository';
import { KnownPiiProfile } from '../../common/pii/pii.types';

/**
 * EŞZAMANLILIK VE SIRALAMA DENETİMİ.
 *
 * Sorulan sorular:
 *   1. Vault yazımı ile LLM çağrısı arasında yarış durumu (race condition) var mı?
 *   2. Vault yazımı YARIM kalırsa "yetim token" (çözülemeyen maskeli metin) oluşur mu?
 *   3. Aynı kullanıcı için eşzamanlı iki analiz birbirinin haritasını bozar mı?
 *   4. Farklı kullanıcıların vault kayıtları birbirine karışır mı?
 */

const FIXTURE_DIR = join(__dirname, '../../../test-fixtures');
const LETTER_DIR = join(FIXTURE_DIR, 'behordenbriefe');
const expected: Record<string, { file: string }> = JSON.parse(
  readFileSync(join(LETTER_DIR, 'expected.json'), 'utf8'),
);
const profiles: Record<string, KnownPiiProfile> = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'profiles.json'), 'utf8'),
);
const keys = Object.keys(expected);

describe('AnalysisPipeline — eşzamanlılık ve sıralama', () => {
  let app: INestApplication;
  let pipeline: AnalysisPipeline;

  beforeEach(async () => {
    const ref = await Test.createTestingModule({
      imports: [AppModule, AnalysisModule],
    }).compile();
    app = ref.createNestApplication();
    await app.init();
    pipeline = app.get(AnalysisPipeline);
  });

  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  const makeUser = (suffix: string) =>
    app.get(UserRepository).create({
      channel: 'telegram',
      channelUserId: `conc-${suffix}`,
      locale: 'tr',
    });

  const letterOf = (k: string) =>
    readFileSync(join(LETTER_DIR, expected[k].file), 'utf8');

  // ── 1. Sıralama: vault, maskeli metinden ÖNCE yazılmalı ───────────────────
  it('vault kaydı, belgeye maskeli metin yazılmadan ÖNCE tamamlanır', async () => {
    const user = await makeUser('order');
    const vaultRepo = app.get(PiiVaultRepository);
    const docRepo = app.get(DocumentRepository);

    let maskedTextWrittenBeforeVault = false;
    const realSaveMany = vaultRepo.saveMany.bind(vaultRepo);

    jest.spyOn(vaultRepo, 'saveMany').mockImplementation(async (records) => {
      // Vault yazılırken belgede maskeli metin HENÜZ olmamalı.
      const docs = await docRepo.findByUser(user.id);
      if (docs.some((d) => d.maskedText)) maskedTextWrittenBeforeVault = true;
      return realSaveMany(records);
    });

    await pipeline.run({
      userId: user.id,
      source: 'text',
      text: letterOf(keys[0]),
      profile: profiles[keys[0]],
    });

    // Bu sıra önemlidir: maskeli metin, onu çözecek anahtarlar kalıcılaşmadan
    // yazılırsa, süreç o anda ölürse GERİ ÇEVRİLEMEZ bir belge kalırdı.
    expect(maskedTextWrittenBeforeVault).toBe(false);
  });

  // ── 2. Vault yazımı başarısız olursa yetim token kalmamalı ────────────────
  it('vault yazımı başarısız olursa maskeli metin DB\'ye yazılmaz (yetim token yok)', async () => {
    const user = await makeUser('vaultfail');
    const vaultRepo = app.get(PiiVaultRepository);

    jest
      .spyOn(vaultRepo, 'saveMany')
      .mockRejectedValue(new Error('vault yazma hatası (simüle)'));

    await expect(
      pipeline.run({
        userId: user.id,
        source: 'text',
        text: letterOf(keys[0]),
        profile: profiles[keys[0]],
      }),
    ).rejects.toThrow();

    const docs = await app.get(DocumentRepository).findByUser(user.id);
    const doc = docs[0];
    expect(doc.status).toBe('failed');
    // Çözülemeyecek bir maskeli metin geride BIRAKILMAMALI.
    expect(doc.maskedText).toBeFalsy();
  });

  // ── 3. Aynı kullanıcı, eşzamanlı iki analiz ──────────────────────────────
  it('aynı kullanıcı için eşzamanlı iki analiz birbirinin haritasını bozmaz', async () => {
    const user = await makeUser('same-user');

    const [a, b] = await Promise.all([
      pipeline.run({
        userId: user.id,
        source: 'text',
        text: letterOf(keys[0]),
        profile: profiles[keys[0]],
      }),
      pipeline.run({
        userId: user.id,
        source: 'text',
        text: letterOf(keys[1]),
        profile: profiles[keys[1]],
      }),
    ]);

    expect(a.document.id).not.toBe(b.document.id);

    // Her belgenin vault'u YALNIZCA kendi token'larını çözebilmeli.
    const vaultRepo = app.get(PiiVaultRepository);
    const vaultSvc = app.get(PiiVaultService);
    const pii = app.get(PiiService);

    for (const [outcome, key] of [
      [a, keys[0]],
      [b, keys[1]],
    ] as const) {
      const records = await vaultRepo.findByDocument(outcome.document.id);
      const map = vaultSvc.open(records, {
        userId: user.id,
        documentId: outcome.document.id,
      });
      const restored = pii.unmask(outcome.document.maskedText!, map);
      expect(restored).toBe(letterOf(key));
    }
  });

  // ── 4. Farklı kullanıcılar izole ─────────────────────────────────────────
  it('farklı kullanıcıların vault kayıtları birbirine karışmaz', async () => {
    const [u1, u2] = await Promise.all([makeUser('u1'), makeUser('u2')]);

    const [r1, r2] = await Promise.all([
      pipeline.run({
        userId: u1.id,
        source: 'text',
        text: letterOf(keys[0]),
        profile: profiles[keys[0]],
      }),
      pipeline.run({
        userId: u2.id,
        source: 'text',
        text: letterOf(keys[1]),
        profile: profiles[keys[1]],
      }),
    ]);

    const vaultRepo = app.get(PiiVaultRepository);
    const v1 = await vaultRepo.findByDocument(r1.document.id);
    const v2 = await vaultRepo.findByDocument(r2.document.id);

    expect(v1.length).toBeGreaterThan(0);
    expect(v2.length).toBeGreaterThan(0);
    expect(v1.every((r) => r.userId === u1.id)).toBe(true);
    expect(v2.every((r) => r.userId === u2.id)).toBe(true);
  });

  // ── 5. AAD, kaydın başka bağlama taşınmasını engeller ────────────────────
  it('bir kullanıcının vault kaydı BAŞKA kullanıcının bağlamıyla çözülemez', async () => {
    const [u1, u2] = await Promise.all([makeUser('aad1'), makeUser('aad2')]);

    const r1 = await pipeline.run({
      userId: u1.id,
      source: 'text',
      text: letterOf(keys[0]),
      profile: profiles[keys[0]],
    });

    const records = await app
      .get(PiiVaultRepository)
      .findByDocument(r1.document.id);

    // Yanlış kullanıcı kimliğiyle açmayı dene — AAD uyuşmadığı için çözülemez.
    const wrongMap = app.get(PiiVaultService).open(records, {
      userId: u2.id,
      documentId: r1.document.id,
    });

    expect(wrongMap.matches).toHaveLength(0);
  });

  // ── 6. Yüksek eşzamanlılık ───────────────────────────────────────────────
  it('8 eşzamanlı analiz tutarlı sonuç üretir', async () => {
    const users = await Promise.all(
      keys.map((_, i) => makeUser(`bulk-${i}`)),
    );

    const outcomes = await Promise.all(
      keys.map((k, i) =>
        pipeline.run({
          userId: users[i].id,
          source: 'text',
          text: letterOf(k),
          profile: profiles[k],
        }),
      ),
    );

    expect(outcomes).toHaveLength(keys.length);
    expect(new Set(outcomes.map((o) => o.document.id)).size).toBe(keys.length);

    // Her belge kendi metnine geri çevrilebilmeli.
    const vaultRepo = app.get(PiiVaultRepository);
    const vaultSvc = app.get(PiiVaultService);
    const pii = app.get(PiiService);

    for (let i = 0; i < keys.length; i++) {
      const o = outcomes[i];
      const records = await vaultRepo.findByDocument(o.document.id);
      const map = vaultSvc.open(records, {
        userId: users[i].id,
        documentId: o.document.id,
      });
      expect(pii.unmask(o.document.maskedText!, map)).toBe(letterOf(keys[i]));
    }
  });

  // ── 7. LLM çağrısı sırasında süreç ölürse ────────────────────────────────
  it('LLM çağrısından sonra ama vault yazımından önce hata → belge failed', async () => {
    const user = await makeUser('midcrash');
    const vaultRepo = app.get(PiiVaultRepository);

    jest.spyOn(vaultRepo, 'saveMany').mockImplementation(async () => {
      throw new Error('süreç kesintisi (simüle)');
    });

    await expect(
      pipeline.run({
        userId: user.id,
        source: 'text',
        text: letterOf(keys[0]),
        profile: profiles[keys[0]],
      }),
    ).rejects.toThrow();

    const docs = await app.get(DocumentRepository).findByUser(user.id);
    expect(docs[0].status).toBe('failed');
    // Analiz kaydı oluşturulmamış olmalı (kısmi durum bırakılmaz).
    expect(docs[0].maskedText).toBeFalsy();
  });
});

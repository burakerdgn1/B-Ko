/**
 * Supabase sürücüsü duman testi (smoke test) — GERÇEK veritabanına karşı.
 *
 * Neden gerekli: 527 birim/entegrasyon testinin tamamı `memory` sürücüsüyle
 * koşuyor. Supabase repository'leri, mapper'lar ve DB trigger'ları gerçek
 * Postgres'te HİÇ çalıştırılmadı. Bu script o boşluğu kapatır.
 *
 * Kullanım:  npx ts-node -T scripts/smoke-supabase.ts
 *            (.env'den SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY okur)
 *
 * Yazdığı her satırı SONUNDA SİLER (finally bloğu). Test verisi açıkça
 * sentetiktir; gerçek PII kullanılmaz.
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv();

process.env.DB_DRIVER = 'supabase';
process.env.LLM_MOCK = 'true';
process.env.TELEGRAM_MODE = 'disabled';

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { UserRepository } from '../src/modules/persistence/repositories/user.repository';
import { DocumentRepository } from '../src/modules/persistence/repositories/document.repository';
import { AnalysisRepository } from '../src/modules/persistence/repositories/analysis.repository';
import { DraftRepository } from '../src/modules/persistence/repositories/draft.repository';
import { PiiVaultRepository } from '../src/modules/persistence/repositories/pii-vault.repository';
import { AuditRepository } from '../src/modules/persistence/repositories/audit.repository';
import { PiiEntityType } from '../src/common/pii/pii.types';

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('✗ SUPABASE_SERVICE_ROLE_KEY yok (.env)');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  const users = app.get(UserRepository);
  const documents = app.get(DocumentRepository);
  const analyses = app.get(AnalysisRepository);
  const drafts = app.get(DraftRepository);
  const vault = app.get(PiiVaultRepository);
  const audit = app.get(AuditRepository);

  let userId: string | undefined;

  console.log('\n═══════ SUPABASE SÜRÜCÜSÜ DUMAN TESTİ ═══════\n');

  try {
    // ── 1. users: yazma/okuma + mapper ──
    const user = await users.create({
      channel: 'mock',
      channelUserId: `smoke-${Date.now()}`,
      locale: 'tr',
    });
    userId = user.id;
    check('users.create', !!user.id);
    check(
      'mapper: createdAt gerçek Date',
      user.createdAt instanceof Date,
      user.createdAt?.constructor?.name,
    );

    const found = await users.findByChannel('mock', user.channelUserId);
    check('users.findByChannel', found?.id === user.id);

    // ── 2. 0002 migration: profile_completed_at kolonu ──
    const stamped = await users.update(user.id, {
      profileCompletedAt: new Date(),
    });
    check(
      '0002 migration: profile_completed_at yazılabiliyor',
      stamped.profileCompletedAt instanceof Date,
    );

    // ── 3. documents + enum eşlemesi ──
    const doc = await documents.create({
      userId: user.id,
      source: 'text',
      status: 'analyzed',
      maskedText: 'Sehr geehrter Herr [[NAME_1]] — sentetik duman testi',
      deleteAfter: null,
    });
    check('documents.create (enum: source/status)', doc.status === 'analyzed');

    // ── 4. analyses + jsonb alanları ──
    const analysis = await analyses.create({
      documentId: doc.id,
      authority: 'Ausländerbehörde Smoke',
      requestType: 'Test',
      summary: 'maskeli özet [[NAME_1]]',
      deadlineDate: new Date('2026-12-31'),
      riskLevel: 'high',
      missingDocuments: [{ label: 'Testdokument', required: true }],
      nextSteps: ['adım 1', 'adım 2'],
      rawModelOutput: '{}',
      model: 'smoke',
      confidence: 0.9,
      deleteAfter: null,
    });
    check(
      'analyses.create (jsonb + enum + numeric)',
      analysis.missingDocuments.length === 1 && analysis.riskLevel === 'high',
    );
    check(
      'mapper: deadlineDate Date olarak dönüyor',
      analysis.deadlineDate instanceof Date,
    );

    // ── 5. pii_vault: yalnızca ciphertext ──
    const sealed = await vault.saveMany([
      {
        token: '[[NAME_1]]',
        entityType: PiiEntityType.NAME,
        ciphertext: 'c21va2U=',
        iv: 'aXY=',
        authTag: 'dGFn',
        keyVersion: 1,
        documentId: doc.id,
      },
    ]);
    check('pii_vault.saveMany', sealed.length === 1);

    // ── 6. ONAY KAPISI — gerçek DB trigger'ı (KRİTİK) ──
    const draft = await drafts.create({
      analysisId: analysis.id,
      content: 'taslak içerik',
      subject: 'konu',
      language: 'de',
      status: 'draft',
      approvedAt: null,
      rejectedAt: null,
      sentAt: null,
      rejectReason: null,
      deleteAfter: null,
    });
    check('drafts.create', draft.status === 'draft');

    let gateHeld = false;
    try {
      await drafts.update(draft.id, { status: 'sent' });
    } catch {
      gateHeld = true;
    }
    check('ONAY KAPISI: onaysız sent REDDEDİLDİ', gateHeld);

    let bypassBlocked = false;
    try {
      await drafts.update(draft.id, {
        status: 'sent',
        approvedAt: new Date(),
      });
    } catch {
      bypassBlocked = true;
    }
    check(
      'ONAY KAPISI: aynı çağrıda approvedAt ile bypass REDDEDİLDİ (D-014)',
      bypassBlocked,
    );

    const approved = await drafts.update(draft.id, { status: 'approved' });
    check(
      'onay: approved + approvedAt otomatik doldu (DB trigger)',
      approved.status === 'approved' && approved.approvedAt instanceof Date,
    );

    const sent = await drafts.update(draft.id, { status: 'sent' });
    check('onay sonrası sent BAŞARILI', sent.status === 'sent');

    // ── 7. INSERT tarafı kapısı (D-022) ──
    let insertBlocked = false;
    try {
      await drafts.create({
        analysisId: analysis.id,
        content: 'doğrudan sent',
        language: 'de',
        status: 'sent',
        approvedAt: null,
        rejectedAt: null,
        sentAt: null,
        rejectReason: null,
        deleteAfter: null,
      });
    } catch {
      insertBlocked = true;
    }
    check('ONAY KAPISI: doğrudan sent YARATMA reddedildi (D-022)', insertBlocked);

    // ── 8. audit_log ──
    await audit.append({
      userId: user.id,
      action: 'smoke.test',
      entityType: 'user',
      entityId: user.id,
      detail: { note: 'sentetik duman testi' },
    });
    const entries = await audit.findByUser(user.id);
    check('audit_log.append/find', entries.length >= 1);

    // ── 9. cascade silme ──
    await users.delete(user.id);
    userId = undefined;
    const orphanDocs = await documents.findByUser(user.id);
    check('CASCADE: user silinince documents da gitti', orphanDocs.length === 0);
  } catch (error) {
    check(
      'BEKLENMEYEN HATA',
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    // Temizlik: test kullanıcısı kaldıysa sil (cascade her şeyi götürür).
    if (userId) {
      try {
        await users.delete(userId);
        console.log('\n  (temizlik: test kullanıcısı silindi)');
      } catch {
        console.log(`\n  ⚠ TEMİZLİK BAŞARISIZ — elle silinmeli: users.id=${userId}`);
      }
    }
    await app.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n  ── SONUÇ: ${results.length - failed.length}/${results.length} geçti ──`,
  );
  console.log('\n═══════════════════════════════════════════\n');
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();

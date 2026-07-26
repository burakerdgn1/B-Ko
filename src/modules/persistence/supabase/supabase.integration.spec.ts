// ⚠️ ENV import'lardan ÖNCE (D-023) — ayrıca `.env`'i BİLEREK yüklüyoruz.
//
// Testler normalde `.env`'den izoledir (D-032). Bu dosya bilinçli bir
// istisnadır: amacı GERÇEK Supabase veritabanına karşı koşmaktır.
import { config as loadDotenv } from 'dotenv';
loadDotenv();

process.env.NODE_ENV = 'test';
process.env.DB_DRIVER = 'supabase';
process.env.LLM_MOCK = 'true';
process.env.TELEGRAM_MODE = 'disabled';

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../../app.module';
import { UserRepository } from '../repositories/user.repository';
import { DocumentRepository } from '../repositories/document.repository';
import { AnalysisRepository } from '../repositories/analysis.repository';
import { DraftRepository } from '../repositories/draft.repository';
import { ReminderRepository } from '../repositories/reminder.repository';
import { PiiVaultRepository } from '../repositories/pii-vault.repository';
import { AuditRepository } from '../repositories/audit.repository';
import { PiiEntityType } from '../../../common/pii/pii.types';

/**
 * GERÇEK Supabase/Postgres entegrasyon testleri.
 *
 * Neden ayrı ve kapılı: diğer 527 test `memory` sürücüsüyle koşar ve hermetiktir.
 * Bu dosya gerçek bir veritabanına yazar; CI'da kimlik bilgisi olmadığında ve
 * kasıtlı olarak istenmediğinde ATLANIR.
 *
 * Çalıştırmak için:
 *   RUN_SUPABASE_TESTS=1 npx jest supabase.integration
 *
 * Kapsam (kullanıcı talebi):
 *   1. Mapper'lar — snake_case ↔ camelCase, tip dönüşümleri (Date/jsonb/numeric/enum)
 *   2. `profile_completed_at` kolonu (0002 migration)
 *   3. Onay kapısı Postgres trigger'ı (enforce_draft_approval_gate)
 *
 * Yazdığı her satırı siler (afterAll → cascade).
 */

const ENABLED =
  process.env.RUN_SUPABASE_TESTS === '1' &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.SUPABASE_URL;

const d = ENABLED ? describe : describe.skip;

d('Supabase entegrasyonu (GERÇEK veritabanı)', () => {
  let app: INestApplication;
  let users: UserRepository;
  let documents: DocumentRepository;
  let analyses: AnalysisRepository;
  let drafts: DraftRepository;
  let reminders: ReminderRepository;
  let vault: PiiVaultRepository;
  let audit: AuditRepository;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    users = app.get(UserRepository);
    documents = app.get(DocumentRepository);
    analyses = app.get(AnalysisRepository);
    drafts = app.get(DraftRepository);
    reminders = app.get(ReminderRepository);
    vault = app.get(PiiVaultRepository);
    audit = app.get(AuditRepository);
  }, 30000);

  afterAll(async () => {
    // Cascade: user silinince documents/analyses/drafts/reminders/vault gider.
    for (const id of createdUserIds) {
      try {
        await users.delete(id);
      } catch {
        // yut — temizlik hatası testi kırmasın, ama iz bırakmasın
      }
    }
    await app?.close();
  }, 30000);

  /** Her testte benzersiz, açıkça sentetik kullanıcı. */
  const newUser = async (suffix = '') => {
    const u = await users.create({
      channel: 'mock',
      channelUserId: `it-${Date.now()}-${Math.round(performance.now())}${suffix}`,
      locale: 'tr',
    });
    createdUserIds.push(u.id);
    return u;
  };

  // ── 1. MAPPER'LAR ─────────────────────────────────────────────────────────
  describe('1) mapper: snake_case ↔ camelCase ve tip dönüşümleri', () => {
    it('users: tüm alanlar doğru sütuna yazılır ve tipleriyle geri gelir', async () => {
      const consentAt = new Date('2026-01-15T10:30:00.000Z');
      const user = await newUser('-map');

      const updated = await users.update(user.id, {
        visaType: 'Blaue Karte EU',
        familyStatus: 'verheiratet',
        city: 'Berlin',
        consentAt,
        aiDisclosureAckAt: consentAt,
      });

      // camelCase alanlar snake_case sütunlardan geri okunabiliyor mu?
      expect(updated.channelUserId).toBe(user.channelUserId);
      expect(updated.visaType).toBe('Blaue Karte EU');
      expect(updated.familyStatus).toBe('verheiratet');

      // timestamptz → Date (string DEĞİL)
      expect(updated.consentAt).toBeInstanceOf(Date);
      expect(updated.consentAt!.toISOString()).toBe(consentAt.toISOString());
      expect(updated.createdAt).toBeInstanceOf(Date);
      expect(updated.updatedAt).toBeInstanceOf(Date);
    });

    it('analyses: jsonb, numeric, enum ve date doğru tiplerle döner', async () => {
      const user = await newUser('-types');
      const doc = await documents.create({
        userId: user.id,
        source: 'pdf',
        status: 'analyzed',
        maskedText: 'maskeli [[NAME_1]]',
        mimeType: 'application/pdf',
        sizeBytes: 12345,
        deleteAfter: null,
      });

      const analysis = await analyses.create({
        documentId: doc.id,
        authority: 'Ausländerbehörde Test',
        requestType: 'Unterlagennachforderung',
        summary: 'özet [[NAME_1]]',
        deadlineDate: new Date('2026-06-30T00:00:00.000Z'),
        riskLevel: 'critical',
        missingDocuments: [
          { label: 'Mietvertrag', explanation: 'açıklama', required: true },
          { label: 'Gehaltsabrechnung', required: false },
        ],
        nextSteps: ['adım 1', 'adım 2', 'adım 3'],
        rawModelOutput: '{"masked":true}',
        model: 'claude-sonnet-5',
        confidence: 0.87,
        deleteAfter: null,
      });

      // enum
      expect(analysis.riskLevel).toBe('critical');
      // jsonb — dizi yapısı ve iç alanlar korunuyor mu?
      expect(Array.isArray(analysis.missingDocuments)).toBe(true);
      expect(analysis.missingDocuments).toHaveLength(2);
      expect(analysis.missingDocuments[0].label).toBe('Mietvertrag');
      expect(analysis.missingDocuments[0].required).toBe(true);
      expect(analysis.nextSteps).toEqual(['adım 1', 'adım 2', 'adım 3']);
      // numeric(3,2) — string DEĞİL, number olmalı
      expect(typeof analysis.confidence).toBe('number');
      expect(analysis.confidence).toBeCloseTo(0.87, 2);
      // date → Date
      expect(analysis.deadlineDate).toBeInstanceOf(Date);
      expect(analysis.deadlineDate!.toISOString().slice(0, 10)).toBe('2026-06-30');

      // Yeniden okuyunca da aynı mı? (create dönüşü değil, gerçek SELECT)
      const reread = await analyses.findByDocument(doc.id);
      expect(reread).toHaveLength(1);
      expect(reread[0].missingDocuments).toHaveLength(2);
      expect(typeof reread[0].confidence).toBe('number');
      expect(reread[0].deadlineDate).toBeInstanceOf(Date);
    });

    it('documents: enum (source/status) ve nullable alanlar', async () => {
      const user = await newUser('-doc');
      const doc = await documents.create({
        userId: user.id,
        source: 'photo',
        status: 'processing',
        storageRef: null,
        mimeType: 'image/jpeg',
        sizeBytes: 999,
        maskedText: null,
        errorMessage: null,
        deleteAfter: null,
      });

      expect(doc.source).toBe('photo');
      expect(doc.status).toBe('processing');
      expect(doc.maskedText).toBeNull();
      expect(doc.sizeBytes).toBe(999);

      const byUser = await documents.findByUser(user.id);
      expect(byUser.map((x) => x.id)).toContain(doc.id);
    });

    it('reminders: timestamptz + enum, findDue gerçek sorguyla çalışır', async () => {
      const user = await newUser('-rem');
      const past = new Date(Date.now() - 60 * 60 * 1000);

      const rem = await reminders.create({
        userId: user.id,
        analysisId: null,
        kind: 'deadline',
        dueDate: past,
        message: null,
        status: 'scheduled',
        sentAt: null,
        deleteAfter: null,
      });

      expect(rem.dueDate).toBeInstanceOf(Date);
      expect(rem.kind).toBe('deadline');

      const due = await reminders.findDue(new Date());
      expect(due.some((r) => r.id === rem.id)).toBe(true);

      const mine = await reminders.findByUser(user.id);
      expect(mine).toHaveLength(1);
    });

    it('pii_vault: yalnızca ciphertext alanları yazılır/okunur', async () => {
      const user = await newUser('-vault');
      const doc = await documents.create({
        userId: user.id,
        source: 'text',
        status: 'analyzed',
        maskedText: '[[NAME_1]]',
        deleteAfter: null,
      });

      await vault.saveMany([
        {
          token: '[[NAME_1]]',
          entityType: PiiEntityType.NAME,
          ciphertext: 'Y2lwaGVy',
          iv: 'aXZpdg==',
          authTag: 'dGFndGFn',
          keyVersion: 1,
          documentId: doc.id,
        },
      ]);

      const rows = await vault.findByDocument(doc.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].token).toBe('[[NAME_1]]');
      expect(rows[0].entityType).toBe(PiiEntityType.NAME);
      expect(rows[0].ciphertext).toBe('Y2lwaGVy');
      // Düz PII alanı OLMAMALI
      expect(JSON.stringify(rows[0])).not.toContain('original');
    });

    it('audit_log: jsonb detail korunur', async () => {
      const user = await newUser('-audit');
      await audit.append({
        userId: user.id,
        action: 'integration.test',
        entityType: 'user',
        entityId: user.id,
        detail: { count: 3, nested: { ok: true }, list: ['a', 'b'] },
      });

      const entries = await audit.findByUser(user.id);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      const e = entries.find((x) => x.action === 'integration.test');
      expect(e?.detail).toEqual({ count: 3, nested: { ok: true }, list: ['a', 'b'] });
      expect(e?.createdAt).toBeInstanceOf(Date);
    });
  });

  // ── 2. profile_completed_at (0002 migration) ──────────────────────────────
  describe('2) 0002 migration: profile_completed_at kolonu', () => {
    it('kolon mevcut, yazılabiliyor ve Date olarak geri geliyor', async () => {
      const user = await newUser('-prof');
      expect(user.profileCompletedAt).toBeFalsy();

      const stamp = new Date('2026-03-01T08:00:00.000Z');
      const updated = await users.update(user.id, { profileCompletedAt: stamp });

      expect(updated.profileCompletedAt).toBeInstanceOf(Date);
      expect(updated.profileCompletedAt!.toISOString()).toBe(stamp.toISOString());

      // Yeniden SELECT ile de doğrula (create/update dönüşüne güvenme)
      const reread = await users.findById(user.id);
      expect(reread!.profileCompletedAt).toBeInstanceOf(Date);
      expect(reread!.profileCompletedAt!.toISOString()).toBe(stamp.toISOString());
    });

    it('null bırakılabilir (kullanıcı onboarding yapmadıysa)', async () => {
      const user = await newUser('-prof2');
      const reread = await users.findById(user.id);
      expect(reread!.profileCompletedAt ?? null).toBeNull();
    });
  });

  // ── 3. ONAY KAPISI — Postgres trigger'ı ──────────────────────────────────
  describe('3) onay kapısı: enforce_draft_approval_gate (GERÇEK trigger)', () => {
    const makeDraft = async (status: 'draft' | 'pending_approval' = 'draft') => {
      const user = await newUser('-gate');
      const doc = await documents.create({
        userId: user.id,
        source: 'text',
        status: 'analyzed',
        maskedText: '[[NAME_1]]',
        deleteAfter: null,
      });
      const analysis = await analyses.create({
        documentId: doc.id,
        authority: 'Test',
        requestType: 'Test',
        summary: 'özet',
        deadlineDate: null,
        riskLevel: 'medium',
        missingDocuments: [],
        nextSteps: [],
        rawModelOutput: null,
        model: null,
        confidence: null,
        deleteAfter: null,
      });
      return drafts.create({
        analysisId: analysis.id,
        content: 'taslak',
        subject: 'konu',
        language: 'de',
        status,
        approvedAt: null,
        rejectedAt: null,
        sentAt: null,
        rejectReason: null,
        deleteAfter: null,
      });
    };

    it('onaysız "sent" REDDEDİLİR', async () => {
      const draft = await makeDraft();
      await expect(drafts.update(draft.id, { status: 'sent' })).rejects.toThrow();

      const after = await drafts.findById(draft.id);
      expect(after!.status).toBe('draft');
    });

    it('D-014: aynı çağrıda approvedAt uydurarak bypass REDDEDİLİR', async () => {
      const draft = await makeDraft();
      await expect(
        drafts.update(draft.id, { status: 'sent', approvedAt: new Date() }),
      ).rejects.toThrow();

      const after = await drafts.findById(draft.id);
      expect(after!.status).toBe('draft');
      expect(after!.sentAt ?? null).toBeNull();
    });

    it('pending_approval → sent doğrudan REDDEDİLİR', async () => {
      const draft = await makeDraft('pending_approval');
      await expect(drafts.update(draft.id, { status: 'sent' })).rejects.toThrow();
    });

    it('D-022: doğrudan "sent" olarak YARATMAK reddedilir', async () => {
      const base = await makeDraft();
      await expect(
        drafts.create({
          analysisId: base.analysisId,
          content: 'doğrudan sent',
          subject: null,
          language: 'de',
          status: 'sent',
          approvedAt: null,
          rejectedAt: null,
          sentAt: null,
          rejectReason: null,
          deleteAfter: null,
        }),
      ).rejects.toThrow();
    });

    it('MEŞRU YOL: approved (approvedAt trigger ile otomatik) → sent başarılı', async () => {
      const draft = await makeDraft();

      const approved = await drafts.update(draft.id, { status: 'approved' });
      expect(approved.status).toBe('approved');
      // approved_at'i TRIGGER doldurur — uygulama göndermedi.
      expect(approved.approvedAt).toBeInstanceOf(Date);

      const sent = await drafts.update(draft.id, { status: 'sent' });
      expect(sent.status).toBe('sent');
      expect(sent.approvedAt).toBeInstanceOf(Date);
    });

    it('rejected geçişinde rejectedAt trigger ile dolar', async () => {
      const draft = await makeDraft();
      const rejected = await drafts.update(draft.id, {
        status: 'rejected',
        rejectReason: 'yanlış bilgi',
      });
      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectedAt).toBeInstanceOf(Date);
      expect(rejected.rejectReason).toBe('yanlış bilgi');
    });

    it('reddedilmiş taslak sent yapılamaz', async () => {
      const draft = await makeDraft();
      await drafts.update(draft.id, { status: 'rejected' });
      await expect(
        drafts.update(draft.id, { status: 'sent', approvedAt: new Date() }),
      ).rejects.toThrow();
    });
  });

  // ── 4. Cascade silme (GDPR) ──────────────────────────────────────────────
  describe('4) cascade silme', () => {
    it('user silinince documents/analyses/vault kayıtları da gider', async () => {
      const user = await newUser('-cascade');
      const doc = await documents.create({
        userId: user.id,
        source: 'text',
        status: 'analyzed',
        maskedText: '[[NAME_1]]',
        deleteAfter: null,
      });
      await vault.saveMany([
        {
          token: '[[NAME_1]]',
          entityType: PiiEntityType.NAME,
          ciphertext: 'eA==',
          iv: 'eA==',
          authTag: 'eA==',
          keyVersion: 1,
          documentId: doc.id,
        },
      ]);

      await users.delete(user.id);
      createdUserIds.splice(createdUserIds.indexOf(user.id), 1);

      expect(await documents.findByUser(user.id)).toHaveLength(0);
      expect(await vault.findByDocument(doc.id)).toHaveLength(0);
    });
  });
});

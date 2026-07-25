import { DraftMemoryRepository } from './draft.memory.repository';

/**
 * KRİTİK test seti — CLAUDE.md §7 human-in-the-loop onay kapısı.
 * Bu testler geçmeden `Draft` özelliği "tamamlandı" sayılmaz.
 */
describe('DraftMemoryRepository', () => {
  let repo: DraftMemoryRepository;

  beforeEach(() => {
    repo = new DraftMemoryRepository();
  });

  it('CRUD round-trip: oluşturur, bulur, günceller, siler', async () => {
    const created = await repo.create({
      analysisId: 'analysis-1',
      content: 'Sehr geehrte Damen und Herren,...',
      language: 'de',
      status: 'draft',
    });
    expect(created.id).toBeDefined();

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);

    const updated = await repo.update(created.id, { subject: 'Antwort' });
    expect(updated.subject).toBe('Antwort');

    await repo.delete(created.id);
    expect(await repo.findById(created.id)).toBeNull();
  });

  it('findByAnalysis yalnızca ilgili analizin taslaklarını döner', async () => {
    const a = await repo.create({
      analysisId: 'analysis-1',
      content: 'içerik',
      language: 'de',
      status: 'draft',
    });
    await repo.create({
      analysisId: 'analysis-2',
      content: 'içerik',
      language: 'de',
      status: 'draft',
    });

    const results = await repo.findByAnalysis('analysis-1');
    expect(results.map((d) => d.id)).toEqual([a.id]);
  });

  describe('onay kapısı (approval gate)', () => {
    it("approvedAt olmadan status:'sent' güncellemesi hata fırlatır", async () => {
      const draft = await repo.create({
        analysisId: 'analysis-1',
        content: 'içerik',
        language: 'de',
        status: 'draft',
      });

      await expect(repo.update(draft.id, { status: 'sent' })).rejects.toThrow(
        /onay/i,
      );

      // Reddedilen güncelleme sonrası durum değişmemiş olmalı.
      const stillDraft = await repo.findById(draft.id);
      expect(stillDraft?.status).toBe('draft');
    });

    it("status:'approved' sonrası status:'sent' başarılıdır", async () => {
      const draft = await repo.create({
        analysisId: 'analysis-1',
        content: 'içerik',
        language: 'de',
        status: 'draft',
      });

      const approved = await repo.update(draft.id, { status: 'approved' });
      expect(approved.status).toBe('approved');
      expect(approved.approvedAt).toBeInstanceOf(Date);

      const sent = await repo.update(draft.id, { status: 'sent' });
      expect(sent.status).toBe('sent');
      expect(sent.approvedAt).toBeInstanceOf(Date);
    });

    // KRİTİK güvenlik regresyonu: kapı, patch'te uydurulan bir approvedAt ile
    // AŞILAMAZ. Onay, önceden kalıcılaşmış ayrı bir insan eylemi olmalıdır —
    // aksi hâlde tek bir çağrı insan onayını tamamen atlayabilirdi.
    it('approvedAt patch ile birlikte verilse bile sent REDDEDİLİR', async () => {
      const draft = await repo.create({
        analysisId: 'analysis-1',
        content: 'içerik',
        language: 'de',
        status: 'draft',
      });

      await expect(
        repo.update(draft.id, { status: 'sent', approvedAt: new Date() }),
      ).rejects.toThrow(/onay/i);

      const stillDraft = await repo.findById(draft.id);
      expect(stillDraft?.status).toBe('draft');
    });

    it('reddedilmiş taslak doğrudan sent yapılamaz', async () => {
      const draft = await repo.create({
        analysisId: 'analysis-1',
        content: 'içerik',
        language: 'de',
        status: 'draft',
      });

      await repo.update(draft.id, { status: 'rejected' });
      await expect(
        repo.update(draft.id, { status: 'sent', approvedAt: new Date() }),
      ).rejects.toThrow(/onay/i);
    });

    it('pending_approval durumundan doğrudan sent yapılamaz', async () => {
      const draft = await repo.create({
        analysisId: 'analysis-1',
        content: 'içerik',
        language: 'de',
        status: 'pending_approval',
      });

      await expect(repo.update(draft.id, { status: 'sent' })).rejects.toThrow(
        /onay/i,
      );
    });

    it('zaten sent olan taslağın güncellenmesi engellenmez (idempotent)', async () => {
      const draft = await repo.create({
        analysisId: 'analysis-1',
        content: 'içerik',
        language: 'de',
        status: 'draft',
      });

      await repo.update(draft.id, { status: 'approved' });
      await repo.update(draft.id, { status: 'sent' });

      const again = await repo.update(draft.id, { status: 'sent' });
      expect(again.status).toBe('sent');
    });

    it("status:'rejected' geçişinde rejectedAt otomatik doldurulur", async () => {
      const draft = await repo.create({
        analysisId: 'analysis-1',
        content: 'içerik',
        language: 'de',
        status: 'draft',
      });

      const rejected = await repo.update(draft.id, {
        status: 'rejected',
        rejectReason: 'yanlış bilgi',
      });
      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectedAt).toBeInstanceOf(Date);
    });
  });

  it('purgeExpired yalnızca süresi geçmişleri siler, geçmemişlere dokunmaz', async () => {
    const now = new Date('2026-07-25T00:00:00Z');
    const expired = await repo.create({
      analysisId: 'analysis-1',
      content: 'içerik',
      language: 'de',
      status: 'draft',
      deleteAfter: new Date('2026-01-01T00:00:00Z'),
    });
    const alive = await repo.create({
      analysisId: 'analysis-1',
      content: 'içerik',
      language: 'de',
      status: 'draft',
      deleteAfter: new Date('2027-01-01T00:00:00Z'),
    });

    expect(await repo.purgeExpired(now)).toBe(1);
    expect(await repo.findById(expired.id)).toBeNull();
    expect(await repo.findById(alive.id)).not.toBeNull();
  });
});

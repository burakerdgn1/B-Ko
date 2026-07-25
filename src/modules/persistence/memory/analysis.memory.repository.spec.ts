import { AnalysisMemoryRepository } from './analysis.memory.repository';

describe('AnalysisMemoryRepository', () => {
  let repo: AnalysisMemoryRepository;

  beforeEach(() => {
    repo = new AnalysisMemoryRepository();
  });

  it('CRUD round-trip: oluşturur, bulur, günceller, siler', async () => {
    const created = await repo.create({
      documentId: 'doc-1',
      riskLevel: 'medium',
      missingDocuments: [],
      nextSteps: [],
    });
    expect(created.id).toBeDefined();

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);

    const updated = await repo.update(created.id, { riskLevel: 'high' });
    expect(updated.riskLevel).toBe('high');

    await repo.delete(created.id);
    expect(await repo.findById(created.id)).toBeNull();
  });

  it('findByDocument yalnızca ilgili belgenin analizlerini döner', async () => {
    const a = await repo.create({
      documentId: 'doc-1',
      riskLevel: 'low',
      missingDocuments: [],
      nextSteps: [],
    });
    await repo.create({
      documentId: 'doc-2',
      riskLevel: 'low',
      missingDocuments: [],
      nextSteps: [],
    });

    const results = await repo.findByDocument('doc-1');
    expect(results.map((r) => r.id)).toEqual([a.id]);
  });

  it('findWithUpcomingDeadlines yalnızca verilen tarihten önce/eşit deadline\'ları döner', async () => {
    const soon = await repo.create({
      documentId: 'doc-1',
      riskLevel: 'high',
      missingDocuments: [],
      nextSteps: [],
      deadlineDate: new Date('2026-08-01T00:00:00Z'),
    });
    await repo.create({
      documentId: 'doc-2',
      riskLevel: 'high',
      missingDocuments: [],
      nextSteps: [],
      deadlineDate: new Date('2027-01-01T00:00:00Z'),
    });
    await repo.create({
      documentId: 'doc-3',
      riskLevel: 'low',
      missingDocuments: [],
      nextSteps: [],
    });

    const upcoming = await repo.findWithUpcomingDeadlines(new Date('2026-08-15T00:00:00Z'));
    expect(upcoming.map((a) => a.id)).toEqual([soon.id]);
  });

  it('purgeExpired yalnızca süresi geçmişleri siler, geçmemişlere dokunmaz', async () => {
    const now = new Date('2026-07-25T00:00:00Z');
    const expired = await repo.create({
      documentId: 'doc-1',
      riskLevel: 'low',
      missingDocuments: [],
      nextSteps: [],
      deleteAfter: new Date('2026-01-01T00:00:00Z'),
    });
    const alive = await repo.create({
      documentId: 'doc-1',
      riskLevel: 'low',
      missingDocuments: [],
      nextSteps: [],
      deleteAfter: new Date('2027-01-01T00:00:00Z'),
    });

    expect(await repo.purgeExpired(now)).toBe(1);
    expect(await repo.findById(expired.id)).toBeNull();
    expect(await repo.findById(alive.id)).not.toBeNull();
  });
});

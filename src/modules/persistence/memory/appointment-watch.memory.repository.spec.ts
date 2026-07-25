import { AppointmentWatchMemoryRepository } from './appointment-watch.memory.repository';

describe('AppointmentWatchMemoryRepository', () => {
  let repo: AppointmentWatchMemoryRepository;

  beforeEach(() => {
    repo = new AppointmentWatchMemoryRepository();
  });

  it('CRUD round-trip: oluşturur, bulur, günceller, siler', async () => {
    const created = await repo.create({
      userId: 'user-1',
      authorityKey: 'auslaenderbehoerde-berlin',
      targetUrl: 'https://example.test/termine',
      status: 'active',
      lastResult: {},
      checkCount: 0,
    });
    expect(created.id).toBeDefined();

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);

    const updated = await repo.update(created.id, {
      checkCount: 1,
      lastCheckedAt: new Date(),
    });
    expect(updated.checkCount).toBe(1);

    await repo.delete(created.id);
    expect(await repo.findById(created.id)).toBeNull();
  });

  it("findActive yalnızca status:'active' olan izlemeleri döner", async () => {
    const active = await repo.create({
      userId: 'user-1',
      authorityKey: 'auslaenderbehoerde-berlin',
      targetUrl: 'https://example.test/termine',
      status: 'active',
      lastResult: {},
      checkCount: 0,
    });
    await repo.create({
      userId: 'user-1',
      authorityKey: 'auslaenderbehoerde-berlin',
      targetUrl: 'https://example.test/termine',
      status: 'paused',
      lastResult: {},
      checkCount: 0,
    });

    const activeWatches = await repo.findActive();
    expect(activeWatches.map((w) => w.id)).toEqual([active.id]);
  });

  it('purgeExpired yalnızca süresi geçmişleri siler, geçmemişlere dokunmaz', async () => {
    const now = new Date('2026-07-25T00:00:00Z');
    const expired = await repo.create({
      userId: 'user-1',
      authorityKey: 'auslaenderbehoerde-berlin',
      targetUrl: 'https://example.test/termine',
      status: 'active',
      lastResult: {},
      checkCount: 0,
      deleteAfter: new Date('2026-01-01T00:00:00Z'),
    });
    const alive = await repo.create({
      userId: 'user-1',
      authorityKey: 'auslaenderbehoerde-berlin',
      targetUrl: 'https://example.test/termine',
      status: 'active',
      lastResult: {},
      checkCount: 0,
      deleteAfter: new Date('2027-01-01T00:00:00Z'),
    });

    expect(await repo.purgeExpired(now)).toBe(1);
    expect(await repo.findById(expired.id)).toBeNull();
    expect(await repo.findById(alive.id)).not.toBeNull();
  });
});

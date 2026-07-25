import { DocumentMemoryRepository } from './document.memory.repository';

describe('DocumentMemoryRepository', () => {
  let repo: DocumentMemoryRepository;

  beforeEach(() => {
    repo = new DocumentMemoryRepository();
  });

  it('CRUD round-trip: oluşturur, bulur, günceller, siler', async () => {
    const created = await repo.create({
      userId: 'user-1',
      source: 'photo',
      status: 'received',
    });
    expect(created.id).toBeDefined();

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);

    const updated = await repo.update(created.id, {
      status: 'analyzed',
      maskedText: '[[NAME_1]] belgesi',
    });
    expect(updated.status).toBe('analyzed');
    expect(updated.maskedText).toBe('[[NAME_1]] belgesi');

    await repo.delete(created.id);
    expect(await repo.findById(created.id)).toBeNull();
  });

  it('findByUser yalnızca ilgili kullanıcının belgelerini döner (en yeni önce)', async () => {
    const older = await repo.create({ userId: 'user-1', source: 'pdf', status: 'received' });
    const newer = await repo.create({ userId: 'user-1', source: 'photo', status: 'received' });
    await repo.create({ userId: 'user-2', source: 'photo', status: 'received' });

    const docs = await repo.findByUser('user-1');
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.id)).toEqual(
      expect.arrayContaining([older.id, newer.id]),
    );
    expect(docs.every((d) => d.userId === 'user-1')).toBe(true);
  });

  it('purgeExpired yalnızca süresi geçmişleri siler, geçmemişlere dokunmaz', async () => {
    const now = new Date('2026-07-25T00:00:00Z');
    const expired = await repo.create({
      userId: 'user-1',
      source: 'photo',
      status: 'received',
      deleteAfter: new Date('2026-01-01T00:00:00Z'),
    });
    const alive = await repo.create({
      userId: 'user-1',
      source: 'photo',
      status: 'received',
      deleteAfter: new Date('2027-01-01T00:00:00Z'),
    });

    expect(await repo.purgeExpired(now)).toBe(1);
    expect(await repo.findById(expired.id)).toBeNull();
    expect(await repo.findById(alive.id)).not.toBeNull();
  });
});

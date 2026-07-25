import { UserMemoryRepository } from './user.memory.repository';

describe('UserMemoryRepository', () => {
  let repo: UserMemoryRepository;

  beforeEach(() => {
    repo = new UserMemoryRepository();
  });

  it('CRUD round-trip: oluşturur, bulur, günceller, siler', async () => {
    const created = await repo.create({
      channel: 'telegram',
      channelUserId: 'tg-1',
      locale: 'de',
    });
    expect(created.id).toBeDefined();
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);

    const updated = await repo.update(created.id, { city: 'Berlin' });
    expect(updated.city).toBe('Berlin');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

    await repo.delete(created.id);
    expect(await repo.findById(created.id)).toBeNull();
  });

  it('findById olmayan kayıt için null döner', async () => {
    expect(await repo.findById('yok-boyle-bir-id')).toBeNull();
  });

  it('upsertByChannel aynı kanal+id için ikinci çağrıda yeni kayıt YARATMAZ', async () => {
    const first = await repo.upsertByChannel('telegram', 'tg-42', { locale: 'de' });
    const second = await repo.upsertByChannel('telegram', 'tg-42', { city: 'München' });

    expect(second.id).toBe(first.id);
    expect(second.city).toBe('München');

    const all = await repo.findByChannel('telegram', 'tg-42');
    expect(all?.id).toBe(first.id);
  });

  it('upsertByChannel farklı kanal/id için yeni kayıt yaratır', async () => {
    const a = await repo.upsertByChannel('telegram', 'tg-1', {});
    const b = await repo.upsertByChannel('telegram', 'tg-2', {});
    expect(a.id).not.toBe(b.id);
  });

  it('purgeExpired yalnızca süresi geçmişleri siler, geçmemişlere dokunmaz', async () => {
    const now = new Date('2026-07-25T00:00:00Z');
    const past = new Date('2026-01-01T00:00:00Z');
    const future = new Date('2027-01-01T00:00:00Z');

    const expired = await repo.create({
      channel: 'telegram',
      channelUserId: 'expired',
      locale: 'de',
      deleteAfter: past,
    });
    const alive = await repo.create({
      channel: 'telegram',
      channelUserId: 'alive',
      locale: 'de',
      deleteAfter: future,
    });
    const noExpiry = await repo.create({
      channel: 'telegram',
      channelUserId: 'no-expiry',
      locale: 'de',
    });

    const deletedCount = await repo.purgeExpired(now);

    expect(deletedCount).toBe(1);
    expect(await repo.findById(expired.id)).toBeNull();
    expect(await repo.findById(alive.id)).not.toBeNull();
    expect(await repo.findById(noExpiry.id)).not.toBeNull();
  });
});

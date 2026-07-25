import { ReminderMemoryRepository } from './reminder.memory.repository';

describe('ReminderMemoryRepository', () => {
  let repo: ReminderMemoryRepository;

  beforeEach(() => {
    repo = new ReminderMemoryRepository();
  });

  it('CRUD round-trip: oluşturur, bulur, günceller, siler', async () => {
    const created = await repo.create({
      userId: 'user-1',
      kind: 'deadline',
      dueDate: new Date('2026-08-01T00:00:00Z'),
      status: 'scheduled',
    });
    expect(created.id).toBeDefined();

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);

    const updated = await repo.update(created.id, { status: 'sent', sentAt: new Date() });
    expect(updated.status).toBe('sent');

    await repo.delete(created.id);
    expect(await repo.findById(created.id)).toBeNull();
  });

  it("findDue yalnızca status:'scheduled' ve dueDate <= now olanları döner", async () => {
    const now = new Date('2026-07-25T12:00:00Z');

    const due = await repo.create({
      userId: 'user-1',
      kind: 'deadline',
      dueDate: new Date('2026-07-25T00:00:00Z'),
      status: 'scheduled',
    });
    await repo.create({
      userId: 'user-1',
      kind: 'deadline',
      dueDate: new Date('2026-08-01T00:00:00Z'),
      status: 'scheduled',
    }); // henüz vadesi gelmemiş
    await repo.create({
      userId: 'user-1',
      kind: 'followup',
      dueDate: new Date('2026-07-01T00:00:00Z'),
      status: 'sent',
    }); // zaten gönderilmiş
    await repo.create({
      userId: 'user-1',
      kind: 'followup',
      dueDate: new Date('2026-07-01T00:00:00Z'),
      status: 'cancelled',
    }); // iptal edilmiş

    const dueReminders = await repo.findDue(now);
    expect(dueReminders.map((r) => r.id)).toEqual([due.id]);
  });

  it('purgeExpired yalnızca süresi geçmişleri siler, geçmemişlere dokunmaz', async () => {
    const now = new Date('2026-07-25T00:00:00Z');
    const expired = await repo.create({
      userId: 'user-1',
      kind: 'deadline',
      dueDate: new Date('2026-08-01T00:00:00Z'),
      status: 'scheduled',
      deleteAfter: new Date('2026-01-01T00:00:00Z'),
    });
    const alive = await repo.create({
      userId: 'user-1',
      kind: 'deadline',
      dueDate: new Date('2026-08-01T00:00:00Z'),
      status: 'scheduled',
      deleteAfter: new Date('2027-01-01T00:00:00Z'),
    });

    expect(await repo.purgeExpired(now)).toBe(1);
    expect(await repo.findById(expired.id)).toBeNull();
    expect(await repo.findById(alive.id)).not.toBeNull();
  });
});

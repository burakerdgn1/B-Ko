import { AuditMemoryRepository } from './audit.memory.repository';

describe('AuditMemoryRepository', () => {
  let repo: AuditMemoryRepository;

  beforeEach(() => {
    repo = new AuditMemoryRepository();
  });

  it('CRUD round-trip: oluşturur, bulur, günceller, siler', async () => {
    const created = await repo.create({
      userId: 'user-1',
      action: 'draft.approved',
      detail: { draftId: 'draft-1' },
    });
    expect(created.id).toBeDefined();
    expect(created.createdAt).toBeInstanceOf(Date);

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);

    const updated = await repo.update(created.id, { entityType: 'draft' });
    expect(updated.entityType).toBe('draft');

    await repo.delete(created.id);
    expect(await repo.findById(created.id)).toBeNull();
  });

  it('append create ile eşdeğer bir audit girdisi ekler', async () => {
    const entry = await repo.append({
      userId: 'user-1',
      action: 'llm.call',
      detail: {},
    });
    expect(await repo.findById(entry.id)).toEqual(entry);
  });

  it('findByUser yalnızca ilgili kullanıcının girdilerini döner (en yeni önce)', async () => {
    await repo.append({ userId: 'user-1', action: 'a1', detail: {} });
    await repo.append({ userId: 'user-2', action: 'a2', detail: {} });
    const last = await repo.append({ userId: 'user-1', action: 'a3', detail: {} });

    const results = await repo.findByUser('user-1');
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe(last.id);
  });

  it('detail alanı asla ham PII taşımaz varsayımıyla token/id saklanır (biçim testi)', async () => {
    const entry = await repo.append({
      userId: 'user-1',
      action: 'llm.call',
      detail: { token: '[[NAME_1]]' },
    });
    expect(entry.detail).toEqual({ token: '[[NAME_1]]' });
  });

  it("purgeExpired her zaman 0 döner (audit_log şemasında delete_after yok)", async () => {
    await repo.append({ userId: 'user-1', action: 'a1', detail: {} });
    expect(await repo.purgeExpired(new Date())).toBe(0);
  });
});

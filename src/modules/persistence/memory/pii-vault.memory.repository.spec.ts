import { PiiEntityType } from '../../../common/pii/pii.types';
import { PiiVaultMemoryRepository } from './pii-vault.memory.repository';

describe('PiiVaultMemoryRepository', () => {
  let repo: PiiVaultMemoryRepository;

  beforeEach(() => {
    repo = new PiiVaultMemoryRepository();
  });

  const sealedRecord = (overrides: Partial<Parameters<PiiVaultMemoryRepository['create']>[0]> = {}) => ({
    token: '[[NAME_1]]',
    entityType: PiiEntityType.NAME,
    ciphertext: 'Y2lwaGVy',
    iv: 'aXY=',
    authTag: 'dGFn',
    keyVersion: 1,
    documentId: 'doc-1',
    ...overrides,
  });

  it('round-trip: mühürlü kayıt kaydedilir ve aynen geri okunur', async () => {
    const created = await repo.create(sealedRecord());
    expect(created.id).toBeDefined();
    expect(created.createdAt).toBeInstanceOf(Date);

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);
    // Düz metin PII asla tutulmaz — yalnızca ciphertext/iv/authTag.
    expect(found).not.toHaveProperty('original');
  });

  it('update/delete beklendiği gibi çalışır', async () => {
    const created = await repo.create(sealedRecord());
    const updated = await repo.update(created.id, { keyVersion: 2 });
    expect(updated.keyVersion).toBe(2);

    await repo.delete(created.id);
    expect(await repo.findById(created.id)).toBeNull();
  });

  it('saveMany birden fazla kaydı tek seferde kaydeder', async () => {
    const saved = await repo.saveMany([
      sealedRecord({ token: '[[NAME_1]]' }),
      sealedRecord({ token: '[[ADDRESS_1]]', entityType: PiiEntityType.ADDRESS }),
    ]);
    expect(saved).toHaveLength(2);
    expect(new Set(saved.map((s) => s.id)).size).toBe(2);
  });

  it('findByDocument ve findByUser doğru kapsamla filtreler', async () => {
    await repo.saveMany([
      sealedRecord({ documentId: 'doc-1', userId: undefined }),
      sealedRecord({ documentId: 'doc-2', userId: undefined, token: '[[NAME_2]]' }),
      sealedRecord({ documentId: undefined, userId: 'user-1', token: '[[NAME_3]]' }),
    ]);

    expect(await repo.findByDocument('doc-1')).toHaveLength(1);
    expect(await repo.findByUser('user-1')).toHaveLength(1);
  });

  it('deleteByDocument yalnızca o belgeye ait kayıtları siler', async () => {
    await repo.saveMany([
      sealedRecord({ documentId: 'doc-1', token: '[[NAME_1]]' }),
      sealedRecord({ documentId: 'doc-1', token: '[[NAME_2]]' }),
      sealedRecord({ documentId: 'doc-2', token: '[[NAME_3]]' }),
    ]);

    await repo.deleteByDocument('doc-1');

    expect(await repo.findByDocument('doc-1')).toHaveLength(0);
    expect(await repo.findByDocument('doc-2')).toHaveLength(1);
  });

  it('purgeExpired yalnızca süresi geçmişleri siler, geçmemişlere dokunmaz', async () => {
    const now = new Date('2026-07-25T00:00:00Z');
    const expired = await repo.create(
      sealedRecord({ deleteAfter: new Date('2026-01-01T00:00:00Z') }),
    );
    const alive = await repo.create(
      sealedRecord({ deleteAfter: new Date('2027-01-01T00:00:00Z') }),
    );

    expect(await repo.purgeExpired(now)).toBe(1);
    expect(await repo.findById(expired.id)).toBeNull();
    expect(await repo.findById(alive.id)).not.toBeNull();
  });
});

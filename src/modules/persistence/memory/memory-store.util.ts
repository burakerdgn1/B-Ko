/**
 * Basit, Map tabanlı bellek-içi depo yardımcı sınıfı.
 *
 * Tüm `*.memory.repository.ts` implementasyonları bu sınıfı sarmalar; amaç
 * CRUD/purge tekrarını tek yerde toplamak. `deepClone` ile derin kopya alınır
 * ki dışarıya dönen nesnenin mutasyonu depo durumunu bozmasın (ör. çağıran
 * taraf döndürülen objenin bir alanını değiştirirse iç Map etkilenmez).
 *
 * Not: kasıtlı olarak global `structuredClone` KULLANILMIYOR — Jest'in
 * `node` test ortamı her test dosyası için ayrı bir VM realm'i kurar; Node'un
 * global `structuredClone`'u ürettiği `Date` nesneleri o realm'in `Date`
 * sınıfından değil, dış (host) realm'den gelir ve `instanceof Date` testleri
 * sahte biçimde başarısız olur. Aşağıdaki elle yazılmış `deepClone`, bu
 * modülün kendi (sandbox-içi) `Date`/`Array`/`Object` referanslarını kullanır.
 */
export class MemoryStore<T extends { id: string }> {
  private readonly rows = new Map<string, T>();

  insert(row: T): T {
    this.rows.set(row.id, deepClone(row));
    return deepClone(row);
  }

  get(id: string): T | null {
    const row = this.rows.get(id);
    return row ? deepClone(row) : null;
  }

  set(id: string, row: T): T {
    this.rows.set(id, deepClone(row));
    return deepClone(row);
  }

  remove(id: string): void {
    this.rows.delete(id);
  }

  all(): T[] {
    return [...this.rows.values()].map((r) => deepClone(r));
  }

  /** `getDeleteAfter(row) < now` olan kayıtları siler; silinen adedi döner. */
  purgeExpired(now: Date, getDeleteAfter: (row: T) => Date | null | undefined): number {
    let count = 0;
    for (const [id, row] of this.rows) {
      const deleteAfter = getDeleteAfter(row);
      if (deleteAfter && deleteAfter.getTime() < now.getTime()) {
        this.rows.delete(id);
        count++;
      }
    }
    return count;
  }
}

/** Bkz. sınıf üstü not — realm-güvenli elle yazılmış derin kopya. */
function deepClone<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepClone(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepClone(v);
    }
    return out as T;
  }
  return value;
}

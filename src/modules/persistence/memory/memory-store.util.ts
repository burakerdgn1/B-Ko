/**
 * Basit, Map tabanlı bellek-içi depo yardımcı sınıfı.
 *
 * Tüm `*.memory.repository.ts` implementasyonları bu sınıfı sarmalar; amaç
 * CRUD/purge tekrarını tek yerde toplamak. `structuredClone` ile derin kopya
 * alınır ki dışarıya dönen nesnenin mutasyonu depo durumunu bozmasın (ör.
 * çağıran taraf döndürülen objenin bir alanını değiştirirse iç Map etkilenmez).
 */
export class MemoryStore<T extends { id: string }> {
  private readonly rows = new Map<string, T>();

  insert(row: T): T {
    this.rows.set(row.id, structuredClone(row));
    return structuredClone(row);
  }

  get(id: string): T | null {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }

  set(id: string, row: T): T {
    this.rows.set(id, structuredClone(row));
    return structuredClone(row);
  }

  remove(id: string): void {
    this.rows.delete(id);
  }

  all(): T[] {
    return [...this.rows.values()].map((r) => structuredClone(r));
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

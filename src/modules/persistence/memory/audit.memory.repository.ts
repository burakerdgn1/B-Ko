import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditEntry } from '../../../common/types/domain';
import {
  AuditRepository,
  CreateAuditInput,
  UpdateAuditInput,
} from '../repositories/audit.repository';
import { MemoryStore } from './memory-store.util';

/** `AuditRepository`'nin in-memory implementasyonu. */
@Injectable()
export class AuditMemoryRepository extends AuditRepository {
  private readonly store = new MemoryStore<AuditEntry>();

  async create(entry: CreateAuditInput): Promise<AuditEntry> {
    const row: AuditEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: new Date(),
    };
    return this.store.insert(row);
  }

  async findById(id: string): Promise<AuditEntry | null> {
    return this.store.get(id);
  }

  async update(id: string, patch: UpdateAuditInput): Promise<AuditEntry> {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Audit girdisi bulunamadı: ${id}`);
    }
    const updated: AuditEntry = { ...existing, ...patch };
    return this.store.set(id, updated);
  }

  async delete(id: string): Promise<void> {
    this.store.remove(id);
  }

  async append(entry: CreateAuditInput): Promise<AuditEntry> {
    return this.create(entry);
  }

  async findByUser(userId: string): Promise<AuditEntry[]> {
    return this.store
      .all()
      .filter((a) => a.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * `AuditEntry`/`audit_log` şemasında `delete_after` yok (bkz.
   * `audit.repository.ts` üzerindeki not) — bu yüzden her zaman `0` döner.
   */
  async purgeExpired(_now: Date): Promise<number> {
    return 0;
  }
}

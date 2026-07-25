import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SealedPiiRecord } from '../../../common/pii/pii-vault.service';
import {
  PiiVaultRepository,
  SealedPiiRecordRow,
} from '../repositories/pii-vault.repository';
import { MemoryStore } from './memory-store.util';

/**
 * `PiiVaultRepository`'nin in-memory implementasyonu.
 *
 * Yalnızca mühürlü (`ciphertext`/`iv`/`authTag`) kayıtları kabul eder; düz
 * metin PII bu sınıfa hiçbir zaman ulaşmaz — arayüz zaten bunu zorlar.
 */
@Injectable()
export class PiiVaultMemoryRepository extends PiiVaultRepository {
  private readonly store = new MemoryStore<SealedPiiRecordRow>();

  async create(record: SealedPiiRecord): Promise<SealedPiiRecordRow> {
    const row: SealedPiiRecordRow = {
      ...record,
      id: randomUUID(),
      createdAt: new Date(),
    };
    return this.store.insert(row);
  }

  async findById(id: string): Promise<SealedPiiRecordRow | null> {
    return this.store.get(id);
  }

  async update(id: string, patch: Partial<SealedPiiRecord>): Promise<SealedPiiRecordRow> {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`PII vault kaydı bulunamadı: ${id}`);
    }
    const updated: SealedPiiRecordRow = { ...existing, ...patch };
    return this.store.set(id, updated);
  }

  async delete(id: string): Promise<void> {
    this.store.remove(id);
  }

  async saveMany(records: SealedPiiRecord[]): Promise<SealedPiiRecordRow[]> {
    const saved: SealedPiiRecordRow[] = [];
    for (const record of records) {
      saved.push(await this.create(record));
    }
    return saved;
  }

  async findByDocument(documentId: string): Promise<SealedPiiRecordRow[]> {
    return this.store.all().filter((r) => r.documentId === documentId);
  }

  async findByUser(userId: string): Promise<SealedPiiRecordRow[]> {
    return this.store.all().filter((r) => r.userId === userId);
  }

  async deleteByDocument(documentId: string): Promise<void> {
    for (const row of this.store.all()) {
      if (row.documentId === documentId) {
        this.store.remove(row.id);
      }
    }
  }

  async purgeExpired(now: Date): Promise<number> {
    return this.store.purgeExpired(now, (r) => r.deleteAfter ?? null);
  }
}

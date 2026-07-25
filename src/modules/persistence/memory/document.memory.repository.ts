import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DocumentRecord } from '../../../common/types/domain';
import {
  CreateDocumentInput,
  DocumentRepository,
  UpdateDocumentInput,
} from '../repositories/document.repository';
import { MemoryStore } from './memory-store.util';

/** `DocumentRepository`'nin in-memory implementasyonu. */
@Injectable()
export class DocumentMemoryRepository extends DocumentRepository {
  private readonly store = new MemoryStore<DocumentRecord>();

  async create(input: CreateDocumentInput): Promise<DocumentRecord> {
    const now = new Date();
    const doc: DocumentRecord = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    return this.store.insert(doc);
  }

  async findById(id: string): Promise<DocumentRecord | null> {
    return this.store.get(id);
  }

  async update(id: string, patch: UpdateDocumentInput): Promise<DocumentRecord> {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Belge bulunamadı: ${id}`);
    }
    const updated: DocumentRecord = { ...existing, ...patch, updatedAt: new Date() };
    return this.store.set(id, updated);
  }

  async delete(id: string): Promise<void> {
    this.store.remove(id);
  }

  async findByUser(userId: string): Promise<DocumentRecord[]> {
    return this.store
      .all()
      .filter((d) => d.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async purgeExpired(now: Date): Promise<number> {
    return this.store.purgeExpired(now, (d) => d.deleteAfter);
  }
}

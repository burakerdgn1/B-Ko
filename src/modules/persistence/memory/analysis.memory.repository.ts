import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Analysis } from '../../../common/types/domain';
import {
  AnalysisRepository,
  CreateAnalysisInput,
  UpdateAnalysisInput,
} from '../repositories/analysis.repository';
import { MemoryStore } from './memory-store.util';

/** `AnalysisRepository`'nin in-memory implementasyonu. */
@Injectable()
export class AnalysisMemoryRepository extends AnalysisRepository {
  private readonly store = new MemoryStore<Analysis>();

  async create(input: CreateAnalysisInput): Promise<Analysis> {
    const now = new Date();
    const analysis: Analysis = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    return this.store.insert(analysis);
  }

  async findById(id: string): Promise<Analysis | null> {
    return this.store.get(id);
  }

  async update(id: string, patch: UpdateAnalysisInput): Promise<Analysis> {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Analiz bulunamadı: ${id}`);
    }
    const updated: Analysis = { ...existing, ...patch, updatedAt: new Date() };
    return this.store.set(id, updated);
  }

  async delete(id: string): Promise<void> {
    this.store.remove(id);
  }

  async findByDocument(documentId: string): Promise<Analysis[]> {
    return this.store.all().filter((a) => a.documentId === documentId);
  }

  async findWithUpcomingDeadlines(before: Date): Promise<Analysis[]> {
    return this.store
      .all()
      .filter((a) => a.deadlineDate != null && a.deadlineDate.getTime() <= before.getTime())
      .sort((a, b) => a.deadlineDate!.getTime() - b.deadlineDate!.getTime());
  }

  async purgeExpired(now: Date): Promise<number> {
    return this.store.purgeExpired(now, (a) => a.deleteAfter);
  }
}

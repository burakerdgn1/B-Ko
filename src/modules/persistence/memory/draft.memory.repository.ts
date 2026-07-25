import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Draft } from '../../../common/types/domain';
import {
  CreateDraftInput,
  DraftRepository,
  UpdateDraftInput,
} from '../repositories/draft.repository';
import { MemoryStore } from './memory-store.util';

/**
 * `DraftRepository`'nin in-memory implementasyonu.
 *
 * Onay kapısı (CLAUDE.md §7): `update()` içinde `status: 'sent'` hedefleniyorsa
 * ve ne mevcut kayıtta ne de patch'te `approvedAt` varsa `Error` fırlatılır.
 * Supabase'deki `drafts_approval_gate` trigger'ının davranışını birebir taklit
 * eder: `status: 'approved'`/`'rejected'` geçişinde ilgili zaman damgası
 * otomatik doldurulur (patch'te verilmemişse).
 */
@Injectable()
export class DraftMemoryRepository extends DraftRepository {
  private readonly store = new MemoryStore<Draft>();

  async create(input: CreateDraftInput): Promise<Draft> {
    const now = new Date();
    const draft: Draft = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    return this.store.insert(draft);
  }

  async findById(id: string): Promise<Draft | null> {
    return this.store.get(id);
  }

  async update(id: string, patch: UpdateDraftInput): Promise<Draft> {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Taslak bulunamadı: ${id}`);
    }

    const merged: Draft = { ...existing, ...patch };

    if (merged.status === 'sent' && !merged.approvedAt) {
      throw new Error(
        `Taslak ${id} insan onayı olmadan 'sent' durumuna geçirilemez ` +
          `(approvedAt boş). Önce 'approved' durumuna geçip onay alınmalı.`,
      );
    }

    if (merged.status === 'approved' && !merged.approvedAt) {
      merged.approvedAt = new Date();
    }
    if (merged.status === 'rejected' && !merged.rejectedAt) {
      merged.rejectedAt = new Date();
    }

    merged.updatedAt = new Date();
    return this.store.set(id, merged);
  }

  async delete(id: string): Promise<void> {
    this.store.remove(id);
  }

  async findByAnalysis(analysisId: string): Promise<Draft[]> {
    return this.store.all().filter((d) => d.analysisId === analysisId);
  }

  async purgeExpired(now: Date): Promise<number> {
    return this.store.purgeExpired(now, (d) => d.deleteAfter);
  }
}

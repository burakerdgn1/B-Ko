import { Injectable } from '@nestjs/common';
import { Draft } from '../../../common/types/domain';
import { draftToRow, DraftRow, mapDraftRow } from '../mappers';
import {
  CreateDraftInput,
  DraftRepository,
  UpdateDraftInput,
} from '../repositories/draft.repository';
import { SupabaseClientProvider } from './supabase-client.provider';
import { assertData, assertNoError } from './supabase.util';

const TABLE = 'drafts';

/**
 * `DraftRepository`'nin Supabase implementasyonu.
 *
 * Onay kapısı (CLAUDE.md §7): `update()`, `status: 'sent'` hedefliyorsa ve
 * (patch'te ya da DB'deki mevcut kayıtta) `approvedAt` yoksa Supabase'e hiç
 * gitmeden `Error` fırlatır. `drafts_approval_gate` DB trigger'ı bunun ikinci
 * savunma hattıdır (uygulama katmanı bu kontrolü atlarsa/bypass edilirse dahi
 * devreye girer).
 */
@Injectable()
export class DraftSupabaseRepository extends DraftRepository {
  constructor(private readonly supabase: SupabaseClientProvider) {
    super();
  }

  async create(input: CreateDraftInput): Promise<Draft> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .insert(draftToRow(input))
      .select()
      .single();
    assertNoError(error, `create(${TABLE})`);
    return mapDraftRow(assertData(data as DraftRow | null, `create(${TABLE})`));
  }

  async findById(id: string): Promise<Draft | null> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    assertNoError(error, `findById(${TABLE})`);
    return data ? mapDraftRow(data as DraftRow) : null;
  }

  async update(id: string, patch: UpdateDraftInput): Promise<Draft> {
    // Onay kapısı (CLAUDE.md §7) — patch'e DEĞİL, DB'deki KAYITLI duruma bakar.
    // Aynı çağrıda {status:'sent', approvedAt: ...} göndererek kapı aşılamaz;
    // onay önceden gerçekleşmiş ayrı bir insan eylemi olmak zorundadır.
    if (patch.status === 'sent') {
      const existing = await this.findById(id);
      if (!existing) {
        throw new Error(`Taslak bulunamadı: ${id}`);
      }
      if (existing.status !== 'sent') {
        if (existing.status !== 'approved' || !existing.approvedAt) {
          throw new Error(
            `Taslak ${id} insan onayı olmadan 'sent' durumuna geçirilemez. ` +
              `Mevcut durum: '${existing.status}'. Önce kullanıcı taslağı ayrı bir ` +
              `adımda onaylamalı ('approved'), ancak ondan sonra 'sent' işaretlenebilir.`,
          );
        }
      }
    }

    const { data, error } = await this.supabase.client
      .from(TABLE)
      .update(draftToRow(patch))
      .eq('id', id)
      .select()
      .single();
    assertNoError(error, `update(${TABLE})`);
    return mapDraftRow(assertData(data as DraftRow | null, `update(${TABLE})`));
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from(TABLE).delete().eq('id', id);
    assertNoError(error, `delete(${TABLE})`);
  }

  async findByAnalysis(analysisId: string): Promise<Draft[]> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('analysis_id', analysisId);
    assertNoError(error, `findByAnalysis(${TABLE})`);
    return (data as DraftRow[] | null)?.map(mapDraftRow) ?? [];
  }

  async purgeExpired(now: Date): Promise<number> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .delete()
      .lt('delete_after', now.toISOString())
      .select('id');
    assertNoError(error, `purgeExpired(${TABLE})`);
    return data?.length ?? 0;
  }
}

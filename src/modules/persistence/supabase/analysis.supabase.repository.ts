import { Injectable } from '@nestjs/common';
import { Analysis } from '../../../common/types/domain';
import { analysisToRow, AnalysisRow, mapAnalysisRow } from '../mappers';
import {
  AnalysisRepository,
  CreateAnalysisInput,
  UpdateAnalysisInput,
} from '../repositories/analysis.repository';
import { SupabaseClientProvider } from './supabase-client.provider';
import { assertData, assertNoError } from './supabase.util';

const TABLE = 'analyses';

/** `AnalysisRepository`'nin Supabase implementasyonu. */
@Injectable()
export class AnalysisSupabaseRepository extends AnalysisRepository {
  constructor(private readonly supabase: SupabaseClientProvider) {
    super();
  }

  async create(input: CreateAnalysisInput): Promise<Analysis> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .insert(analysisToRow(input))
      .select()
      .single();
    assertNoError(error, `create(${TABLE})`);
    return mapAnalysisRow(assertData(data as AnalysisRow | null, `create(${TABLE})`));
  }

  async findById(id: string): Promise<Analysis | null> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    assertNoError(error, `findById(${TABLE})`);
    return data ? mapAnalysisRow(data as AnalysisRow) : null;
  }

  async update(id: string, patch: UpdateAnalysisInput): Promise<Analysis> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .update(analysisToRow(patch))
      .eq('id', id)
      .select()
      .single();
    assertNoError(error, `update(${TABLE})`);
    return mapAnalysisRow(assertData(data as AnalysisRow | null, `update(${TABLE})`));
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from(TABLE).delete().eq('id', id);
    assertNoError(error, `delete(${TABLE})`);
  }

  async findByDocument(documentId: string): Promise<Analysis[]> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('document_id', documentId);
    assertNoError(error, `findByDocument(${TABLE})`);
    return (data as AnalysisRow[] | null)?.map(mapAnalysisRow) ?? [];
  }

  async findWithUpcomingDeadlines(before: Date): Promise<Analysis[]> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .not('deadline_date', 'is', null)
      .lte('deadline_date', before.toISOString().slice(0, 10))
      .order('deadline_date', { ascending: true });
    assertNoError(error, `findWithUpcomingDeadlines(${TABLE})`);
    return (data as AnalysisRow[] | null)?.map(mapAnalysisRow) ?? [];
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

import { Injectable } from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { AuditEntry } from '../../../common/types/domain';
import { AuditRow, auditToRow, mapAuditRow } from '../mappers';
import {
  AuditRepository,
  CreateAuditInput,
  UpdateAuditInput,
} from '../repositories/audit.repository';
import { SupabaseClientProvider } from './supabase-client.provider';
import { assertData, assertNoError } from './supabase.util';

const TABLE = 'audit_log';

/** `AuditRepository`'nin Supabase implementasyonu. */
@Injectable()
export class AuditSupabaseRepository extends AuditRepository {
  constructor(private readonly supabase: SupabaseClientProvider) {
    super();
  }

  async create(entry: CreateAuditInput): Promise<AuditEntry> {
    const { data, error } = (await this.supabase.client
      .from(TABLE)
      .insert(auditToRow(entry))
      .select()
      .single()) as { data: AuditRow | null; error: PostgrestError | null };
    assertNoError(error, `create(${TABLE})`);
    return mapAuditRow(assertData(data, `create(${TABLE})`));
  }

  async findById(id: string): Promise<AuditEntry | null> {
    const { data, error } = (await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle()) as { data: AuditRow | null; error: PostgrestError | null };
    assertNoError(error, `findById(${TABLE})`);
    return data ? mapAuditRow(data) : null;
  }

  async update(id: string, patch: UpdateAuditInput): Promise<AuditEntry> {
    const { data, error } = (await this.supabase.client
      .from(TABLE)
      .update(auditToRow(patch))
      .eq('id', id)
      .select()
      .single()) as { data: AuditRow | null; error: PostgrestError | null };
    assertNoError(error, `update(${TABLE})`);
    return mapAuditRow(assertData(data, `update(${TABLE})`));
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from(TABLE).delete().eq('id', id);
    assertNoError(error, `delete(${TABLE})`);
  }

  async append(entry: CreateAuditInput): Promise<AuditEntry> {
    return this.create(entry);
  }

  async findByUser(userId: string): Promise<AuditEntry[]> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    assertNoError(error, `findByUser(${TABLE})`);
    return (data as AuditRow[] | null)?.map(mapAuditRow) ?? [];
  }

  /** `audit_log` şemasında `delete_after` yok — bkz. audit.repository.ts notu. */
  async purgeExpired(_now: Date): Promise<number> {
    return 0;
  }
}

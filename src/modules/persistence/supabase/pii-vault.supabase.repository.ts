import { Injectable } from '@nestjs/common';
import { SealedPiiRecord } from '../../../common/pii/pii-vault.service';
import { mapPiiVaultRow, PiiVaultRow, piiVaultToRow } from '../mappers';
import {
  PiiVaultRepository,
  SealedPiiRecordRow,
} from '../repositories/pii-vault.repository';
import { SupabaseClientProvider } from './supabase-client.provider';
import { assertData, assertNoError } from './supabase.util';

const TABLE = 'pii_vault';

/**
 * `PiiVaultRepository`'nin Supabase implementasyonu.
 * Yalnızca mühürlü (`ciphertext`/`iv`/`authTag`) alanları yazar/okur.
 */
@Injectable()
export class PiiVaultSupabaseRepository extends PiiVaultRepository {
  constructor(private readonly supabase: SupabaseClientProvider) {
    super();
  }

  async create(record: SealedPiiRecord): Promise<SealedPiiRecordRow> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .insert(piiVaultToRow(record))
      .select()
      .single();
    assertNoError(error, `create(${TABLE})`);
    return mapPiiVaultRow(assertData(data as PiiVaultRow | null, `create(${TABLE})`));
  }

  async findById(id: string): Promise<SealedPiiRecordRow | null> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    assertNoError(error, `findById(${TABLE})`);
    return data ? mapPiiVaultRow(data as PiiVaultRow) : null;
  }

  async update(id: string, patch: Partial<SealedPiiRecord>): Promise<SealedPiiRecordRow> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .update(piiVaultToRow(patch))
      .eq('id', id)
      .select()
      .single();
    assertNoError(error, `update(${TABLE})`);
    return mapPiiVaultRow(assertData(data as PiiVaultRow | null, `update(${TABLE})`));
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from(TABLE).delete().eq('id', id);
    assertNoError(error, `delete(${TABLE})`);
  }

  async saveMany(records: SealedPiiRecord[]): Promise<SealedPiiRecordRow[]> {
    if (records.length === 0) return [];
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .insert(records.map((r) => piiVaultToRow(r)))
      .select();
    assertNoError(error, `saveMany(${TABLE})`);
    return (data as PiiVaultRow[] | null)?.map(mapPiiVaultRow) ?? [];
  }

  async findByDocument(documentId: string): Promise<SealedPiiRecordRow[]> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('document_id', documentId);
    assertNoError(error, `findByDocument(${TABLE})`);
    return (data as PiiVaultRow[] | null)?.map(mapPiiVaultRow) ?? [];
  }

  async findByUser(userId: string): Promise<SealedPiiRecordRow[]> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('user_id', userId);
    assertNoError(error, `findByUser(${TABLE})`);
    return (data as PiiVaultRow[] | null)?.map(mapPiiVaultRow) ?? [];
  }

  async deleteByDocument(documentId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from(TABLE)
      .delete()
      .eq('document_id', documentId);
    assertNoError(error, `deleteByDocument(${TABLE})`);
  }

  async findAllForRotation(): Promise<SealedPiiRecordRow[]> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: true });
    assertNoError(error, `findAllForRotation(${TABLE})`);
    return (data as PiiVaultRow[] | null)?.map(mapPiiVaultRow) ?? [];
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

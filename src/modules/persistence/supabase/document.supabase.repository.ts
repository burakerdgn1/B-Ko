import { Injectable } from '@nestjs/common';
import { DocumentRecord } from '../../../common/types/domain';
import { DocumentRow, documentToRow, mapDocumentRow } from '../mappers';
import {
  CreateDocumentInput,
  DocumentRepository,
  UpdateDocumentInput,
} from '../repositories/document.repository';
import { SupabaseClientProvider } from './supabase-client.provider';
import { assertData, assertNoError } from './supabase.util';

const TABLE = 'documents';

/** `DocumentRepository`'nin Supabase implementasyonu. */
@Injectable()
export class DocumentSupabaseRepository extends DocumentRepository {
  constructor(private readonly supabase: SupabaseClientProvider) {
    super();
  }

  async create(input: CreateDocumentInput): Promise<DocumentRecord> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .insert(documentToRow(input))
      .select()
      .single();
    assertNoError(error, `create(${TABLE})`);
    return mapDocumentRow(assertData(data as DocumentRow | null, `create(${TABLE})`));
  }

  async findById(id: string): Promise<DocumentRecord | null> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    assertNoError(error, `findById(${TABLE})`);
    return data ? mapDocumentRow(data as DocumentRow) : null;
  }

  async update(id: string, patch: UpdateDocumentInput): Promise<DocumentRecord> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .update(documentToRow(patch))
      .eq('id', id)
      .select()
      .single();
    assertNoError(error, `update(${TABLE})`);
    return mapDocumentRow(assertData(data as DocumentRow | null, `update(${TABLE})`));
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from(TABLE).delete().eq('id', id);
    assertNoError(error, `delete(${TABLE})`);
  }

  async findByUser(userId: string): Promise<DocumentRecord[]> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    assertNoError(error, `findByUser(${TABLE})`);
    return (data as DocumentRow[] | null)?.map(mapDocumentRow) ?? [];
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

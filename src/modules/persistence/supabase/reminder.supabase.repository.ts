import { Injectable } from '@nestjs/common';
import { Reminder } from '../../../common/types/domain';
import { mapReminderRow, reminderToRow, ReminderRow } from '../mappers';
import {
  CreateReminderInput,
  ReminderRepository,
  UpdateReminderInput,
} from '../repositories/reminder.repository';
import { SupabaseClientProvider } from './supabase-client.provider';
import { assertData, assertNoError } from './supabase.util';

const TABLE = 'reminders';

/** `ReminderRepository`'nin Supabase implementasyonu. */
@Injectable()
export class ReminderSupabaseRepository extends ReminderRepository {
  constructor(private readonly supabase: SupabaseClientProvider) {
    super();
  }

  async create(input: CreateReminderInput): Promise<Reminder> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .insert(reminderToRow(input))
      .select()
      .single();
    assertNoError(error, `create(${TABLE})`);
    return mapReminderRow(assertData(data as ReminderRow | null, `create(${TABLE})`));
  }

  async findById(id: string): Promise<Reminder | null> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    assertNoError(error, `findById(${TABLE})`);
    return data ? mapReminderRow(data as ReminderRow) : null;
  }

  async update(id: string, patch: UpdateReminderInput): Promise<Reminder> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .update(reminderToRow(patch))
      .eq('id', id)
      .select()
      .single();
    assertNoError(error, `update(${TABLE})`);
    return mapReminderRow(assertData(data as ReminderRow | null, `update(${TABLE})`));
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from(TABLE).delete().eq('id', id);
    assertNoError(error, `delete(${TABLE})`);
  }

  async findDue(now: Date): Promise<Reminder[]> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('status', 'scheduled')
      .lte('due_date', now.toISOString())
      .order('due_date', { ascending: true });
    assertNoError(error, `findDue(${TABLE})`);
    return (data as ReminderRow[] | null)?.map(mapReminderRow) ?? [];
  }

  /** Kullanıcının tüm hatırlatmaları — durumdan bağımsız (GDPR Art.17). */
  async findByUser(userId: string): Promise<Reminder[]> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('due_date', { ascending: true });
    assertNoError(error, `findByUser(${TABLE})`);
    return (data as ReminderRow[] | null)?.map(mapReminderRow) ?? [];
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

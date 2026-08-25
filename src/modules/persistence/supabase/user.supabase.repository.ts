import { Injectable } from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { ChannelKind, User } from '../../../common/types/domain';
import { mapUserRow, UserRow, userToRow } from '../mappers';
import {
  CreateUserInput,
  UpdateUserInput,
  UserRepository,
} from '../repositories/user.repository';
import { SupabaseClientProvider } from './supabase-client.provider';
import { assertData, assertNoError } from './supabase.util';

const TABLE = 'users';

/** `UserRepository`'nin Supabase (Postgres) implementasyonu. */
@Injectable()
export class UserSupabaseRepository extends UserRepository {
  constructor(private readonly supabase: SupabaseClientProvider) {
    super();
  }

  async create(input: CreateUserInput): Promise<User> {
    const { data, error } = (await this.supabase.client
      .from(TABLE)
      .insert(userToRow(input))
      .select()
      .single()) as { data: UserRow | null; error: PostgrestError | null };
    assertNoError(error, `create(${TABLE})`);
    return mapUserRow(assertData(data, `create(${TABLE})`));
  }

  async findById(id: string): Promise<User | null> {
    const { data, error } = (await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle()) as { data: UserRow | null; error: PostgrestError | null };
    assertNoError(error, `findById(${TABLE})`);
    return data ? mapUserRow(data) : null;
  }

  async update(id: string, patch: UpdateUserInput): Promise<User> {
    const { data, error } = (await this.supabase.client
      .from(TABLE)
      .update(userToRow(patch))
      .eq('id', id)
      .select()
      .single()) as { data: UserRow | null; error: PostgrestError | null };
    assertNoError(error, `update(${TABLE})`);
    return mapUserRow(assertData(data, `update(${TABLE})`));
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from(TABLE).delete().eq('id', id);
    assertNoError(error, `delete(${TABLE})`);
  }

  async findByChannel(channel: ChannelKind, channelUserId: string): Promise<User | null> {
    const { data, error } = (await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('channel', channel)
      .eq('channel_user_id', channelUserId)
      .maybeSingle()) as { data: UserRow | null; error: PostgrestError | null };
    assertNoError(error, `findByChannel(${TABLE})`);
    return data ? mapUserRow(data) : null;
  }

  async upsertByChannel(
    channel: ChannelKind,
    channelUserId: string,
    patch: UpdateUserInput = {},
  ): Promise<User> {
    const existing = await this.findByChannel(channel, channelUserId);
    if (existing) {
      return this.update(existing.id, patch);
    }
    return this.create({
      channel,
      channelUserId,
      locale: patch.locale ?? 'de',
      visaType: patch.visaType ?? null,
      familyStatus: patch.familyStatus ?? null,
      city: patch.city ?? null,
      consentAt: patch.consentAt ?? null,
      aiDisclosureAckAt: patch.aiDisclosureAckAt ?? null,
      deleteAfter: patch.deleteAfter ?? null,
    });
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

import { Injectable } from '@nestjs/common';
import { AppointmentWatch } from '../../../common/types/domain';
import {
  AppointmentWatchRow,
  appointmentWatchToRow,
  mapAppointmentWatchRow,
} from '../mappers';
import {
  AppointmentWatchRepository,
  CreateAppointmentWatchInput,
  UpdateAppointmentWatchInput,
} from '../repositories/appointment-watch.repository';
import { SupabaseClientProvider } from './supabase-client.provider';
import { assertData, assertNoError } from './supabase.util';

const TABLE = 'appointment_watches';

/** `AppointmentWatchRepository`'nin Supabase implementasyonu. */
@Injectable()
export class AppointmentWatchSupabaseRepository extends AppointmentWatchRepository {
  constructor(private readonly supabase: SupabaseClientProvider) {
    super();
  }

  async create(input: CreateAppointmentWatchInput): Promise<AppointmentWatch> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .insert(appointmentWatchToRow(input))
      .select()
      .single();
    assertNoError(error, `create(${TABLE})`);
    return mapAppointmentWatchRow(
      assertData(data as AppointmentWatchRow | null, `create(${TABLE})`),
    );
  }

  async findById(id: string): Promise<AppointmentWatch | null> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    assertNoError(error, `findById(${TABLE})`);
    return data ? mapAppointmentWatchRow(data as AppointmentWatchRow) : null;
  }

  async update(
    id: string,
    patch: UpdateAppointmentWatchInput,
  ): Promise<AppointmentWatch> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .update(appointmentWatchToRow(patch))
      .eq('id', id)
      .select()
      .single();
    assertNoError(error, `update(${TABLE})`);
    return mapAppointmentWatchRow(
      assertData(data as AppointmentWatchRow | null, `update(${TABLE})`),
    );
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.from(TABLE).delete().eq('id', id);
    assertNoError(error, `delete(${TABLE})`);
  }

  async findActive(): Promise<AppointmentWatch[]> {
    const { data, error } = await this.supabase.client
      .from(TABLE)
      .select('*')
      .eq('status', 'active');
    assertNoError(error, `findActive(${TABLE})`);
    return (data as AppointmentWatchRow[] | null)?.map(mapAppointmentWatchRow) ?? [];
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

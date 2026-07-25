import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppointmentWatch } from '../../../common/types/domain';
import {
  AppointmentWatchRepository,
  CreateAppointmentWatchInput,
  UpdateAppointmentWatchInput,
} from '../repositories/appointment-watch.repository';
import { MemoryStore } from './memory-store.util';

/** `AppointmentWatchRepository`'nin in-memory implementasyonu. */
@Injectable()
export class AppointmentWatchMemoryRepository extends AppointmentWatchRepository {
  private readonly store = new MemoryStore<AppointmentWatch>();

  async create(input: CreateAppointmentWatchInput): Promise<AppointmentWatch> {
    const now = new Date();
    const watch: AppointmentWatch = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    return this.store.insert(watch);
  }

  async findById(id: string): Promise<AppointmentWatch | null> {
    return this.store.get(id);
  }

  async update(
    id: string,
    patch: UpdateAppointmentWatchInput,
  ): Promise<AppointmentWatch> {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Randevu izlemesi bulunamadı: ${id}`);
    }
    const updated: AppointmentWatch = { ...existing, ...patch, updatedAt: new Date() };
    return this.store.set(id, updated);
  }

  async delete(id: string): Promise<void> {
    this.store.remove(id);
  }

  async findActive(): Promise<AppointmentWatch[]> {
    return this.store.all().filter((w) => w.status === 'active');
  }

  async purgeExpired(now: Date): Promise<number> {
    return this.store.purgeExpired(now, (w) => w.deleteAfter);
  }
}

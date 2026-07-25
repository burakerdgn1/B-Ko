import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Reminder } from '../../../common/types/domain';
import {
  CreateReminderInput,
  ReminderRepository,
  UpdateReminderInput,
} from '../repositories/reminder.repository';
import { MemoryStore } from './memory-store.util';

/** `ReminderRepository`'nin in-memory implementasyonu. */
@Injectable()
export class ReminderMemoryRepository extends ReminderRepository {
  private readonly store = new MemoryStore<Reminder>();

  async create(input: CreateReminderInput): Promise<Reminder> {
    const now = new Date();
    const reminder: Reminder = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    return this.store.insert(reminder);
  }

  async findById(id: string): Promise<Reminder | null> {
    return this.store.get(id);
  }

  async update(id: string, patch: UpdateReminderInput): Promise<Reminder> {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Hatırlatma bulunamadı: ${id}`);
    }
    const updated: Reminder = { ...existing, ...patch, updatedAt: new Date() };
    return this.store.set(id, updated);
  }

  async delete(id: string): Promise<void> {
    this.store.remove(id);
  }

  async findDue(now: Date): Promise<Reminder[]> {
    return this.store
      .all()
      .filter((r) => r.status === 'scheduled' && r.dueDate.getTime() <= now.getTime())
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  }

  async purgeExpired(now: Date): Promise<number> {
    return this.store.purgeExpired(now, (r) => r.deleteAfter);
  }
}

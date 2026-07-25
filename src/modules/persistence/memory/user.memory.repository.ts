import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ChannelKind, User } from '../../../common/types/domain';
import {
  CreateUserInput,
  UpdateUserInput,
  UserRepository,
} from '../repositories/user.repository';
import { MemoryStore } from './memory-store.util';

/**
 * `UserRepository`'nin in-memory implementasyonu (DB_DRIVER=memory).
 * Gerçek Supabase hesabı olmadan geliştirme/test için; process kapanınca veri
 * kaybolur (bkz. AppConfigService dev-fallback uyarısı).
 */
@Injectable()
export class UserMemoryRepository extends UserRepository {
  private readonly store = new MemoryStore<User>();

  async create(input: CreateUserInput): Promise<User> {
    const now = new Date();
    const user: User = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    return this.store.insert(user);
  }

  async findById(id: string): Promise<User | null> {
    return this.store.get(id);
  }

  async update(id: string, patch: UpdateUserInput): Promise<User> {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Kullanıcı bulunamadı: ${id}`);
    }
    const updated: User = { ...existing, ...patch, updatedAt: new Date() };
    return this.store.set(id, updated);
  }

  async delete(id: string): Promise<void> {
    this.store.remove(id);
  }

  async findByChannel(channel: ChannelKind, channelUserId: string): Promise<User | null> {
    const found = this.store
      .all()
      .find((u) => u.channel === channel && u.channelUserId === channelUserId);
    return found ?? null;
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
    return this.store.purgeExpired(now, (u) => u.deleteAfter);
  }
}

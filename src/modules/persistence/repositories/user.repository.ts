import { ChannelKind, User } from '../../../common/types/domain';

/** `users` tablosuna yeni kayıt eklerken gereken alanlar (id/created_at/updated_at hariç). */
export type CreateUserInput = Omit<User, 'id' | 'createdAt' | 'updatedAt'>;

/** Kısmi güncelleme — id/createdAt/updatedAt repository tarafından yönetilir. */
export type UpdateUserInput = Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>;

/**
 * `User` varlığı için repository sözleşmesi.
 *
 * Soyut sınıf olarak tanımlanır (interface değil) ki NestJS DI token'ı olarak
 * kullanılabilsin — `PersistenceModule` bu token'a driver'a göre `memory` ya da
 * `supabase` implementasyonunu bağlar.
 */
export abstract class UserRepository {
  abstract create(input: CreateUserInput): Promise<User>;
  abstract findById(id: string): Promise<User | null>;
  abstract update(id: string, patch: UpdateUserInput): Promise<User>;
  abstract delete(id: string): Promise<void>;

  /** Kanal + kanal-içi kullanıcı kimliğiyle bul (ör. Telegram chat id). */
  abstract findByChannel(
    channel: ChannelKind,
    channelUserId: string,
  ): Promise<User | null>;

  /**
   * Kanal+kimlik ile bul; varsa günceller, yoksa oluşturur.
   * Aynı (channel, channelUserId) çifti için ikinci çağrı YENİ kayıt yaratmaz
   * (bkz. `users_channel_uid_uniq` — 0001_init.sql).
   */
  abstract upsertByChannel(
    channel: ChannelKind,
    channelUserId: string,
    patch?: UpdateUserInput,
  ): Promise<User>;

  /** GDPR Art.17 — `deleteAfter < now` olan kayıtları siler, silinen adedi döner. */
  abstract purgeExpired(now: Date): Promise<number>;
}

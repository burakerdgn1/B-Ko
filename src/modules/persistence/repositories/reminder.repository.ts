import { Reminder } from '../../../common/types/domain';

export type CreateReminderInput = Omit<Reminder, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateReminderInput = Partial<Omit<Reminder, 'id' | 'createdAt' | 'updatedAt'>>;

/** `Reminder` varlığı için repository sözleşmesi. */
export abstract class ReminderRepository {
  abstract create(input: CreateReminderInput): Promise<Reminder>;
  abstract findById(id: string): Promise<Reminder | null>;
  abstract update(id: string, patch: UpdateReminderInput): Promise<Reminder>;
  abstract delete(id: string): Promise<void>;

  /** `status: 'scheduled'` ve `dueDate <= now` olan hatırlatmalar (cron için). */
  abstract findDue(now: Date): Promise<Reminder[]>;

  /**
   * Kullanıcının TÜM hatırlatmaları — durumdan bağımsız.
   *
   * GDPR Art.17 için zorunlu: `findDue` yalnızca `scheduled` olanları döndürdüğü
   * için, "verilerimi sil" talebinde `sent`/`cancelled` hatırlatmalar geride
   * kalırdı. Silme işlemi eksik kalamaz.
   */
  abstract findByUser(userId: string): Promise<Reminder[]>;

  /** GDPR Art.17 — süresi geçmiş kayıtları siler, silinen adedi döner. */
  abstract purgeExpired(now: Date): Promise<number>;
}

import { AppointmentWatch } from '../../../common/types/domain';

export type CreateAppointmentWatchInput = Omit<
  AppointmentWatch,
  'id' | 'createdAt' | 'updatedAt'
>;
export type UpdateAppointmentWatchInput = Partial<
  Omit<AppointmentWatch, 'id' | 'createdAt' | 'updatedAt'>
>;

/** `AppointmentWatch` (Playwright randevu izleme PoC) için repository sözleşmesi. */
export abstract class AppointmentWatchRepository {
  abstract create(input: CreateAppointmentWatchInput): Promise<AppointmentWatch>;
  abstract findById(id: string): Promise<AppointmentWatch | null>;
  abstract update(
    id: string,
    patch: UpdateAppointmentWatchInput,
  ): Promise<AppointmentWatch>;
  abstract delete(id: string): Promise<void>;

  /** `status: 'active'` olan tüm izlemeler (Watcher cron'unun taradığı liste). */
  abstract findActive(): Promise<AppointmentWatch[]>;

  /** GDPR Art.17 — süresi geçmiş kayıtları siler, silinen adedi döner. */
  abstract purgeExpired(now: Date): Promise<number>;
}

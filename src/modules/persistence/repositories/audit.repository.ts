import { AuditEntry } from '../../../common/types/domain';

export type CreateAuditInput = Omit<AuditEntry, 'id' | 'createdAt'>;
export type UpdateAuditInput = Partial<Omit<AuditEntry, 'id' | 'createdAt'>>;

/**
 * `audit_log` için repository sözleşmesi.
 *
 * Not: audit girdileri kavramsal olarak değişmez (append-only) bir izdir;
 * `update`/`delete` yalnızca genel repository sözleşmesini tamamlamak için
 * bulunur, normal akışta `append()` kullanılır.
 */
export abstract class AuditRepository {
  abstract create(entry: CreateAuditInput): Promise<AuditEntry>;
  abstract findById(id: string): Promise<AuditEntry | null>;
  abstract update(id: string, patch: UpdateAuditInput): Promise<AuditEntry>;
  abstract delete(id: string): Promise<void>;

  /** Semantik takma ad — audit girdisi eklemenin asıl yolu budur (`create` ile eşdeğer). */
  abstract append(entry: CreateAuditInput): Promise<AuditEntry>;

  abstract findByUser(userId: string): Promise<AuditEntry[]>;

  /**
   * GDPR Art.17. Not: `AuditEntry`/`audit_log` şemasında `delete_after` alanı
   * yoktur (güvenlik/şeffaflık izi kalıcı tutulur — bkz. DECISIONS.md D-0xx).
   * Bu nedenle bu implementasyon her zaman `0` döner; alan ileride eklenirse
   * (retention politikası netleşince) burada gerçek silme uygulanır.
   */
  abstract purgeExpired(now: Date): Promise<number>;
}

import { SealedPiiRecord } from '../../../common/pii/pii-vault.service';

/**
 * Kalıcı katmandaki mühürlü PII kaydı — `SealedPiiRecord`'a DB kimliği eklenmiş hâli.
 * Not: `pii_vault` tablosunda `updated_at` yoktur (kayıtlar güncellenmez, yeniden
 * mühürlenip yeni satır olarak yazılır ya da GDPR silme ile kaldırılır).
 */
export interface SealedPiiRecordRow extends SealedPiiRecord {
  id: string;
  createdAt: Date;
}

/**
 * `pii_vault` için repository sözleşmesi.
 *
 * KRİTİK: Bu repository YALNIZCA `SealedPiiRecord` (ciphertext/iv/authTag) kabul
 * eder. Düz metin PII alan hiçbir metot burada tanımlanmaz/tanımlanmamalıdır —
 * orijinal değer asla bu katmana çıplak ulaşmaz (DECISIONS D-003/D-004).
 */
export abstract class PiiVaultRepository {
  abstract create(record: SealedPiiRecord): Promise<SealedPiiRecordRow>;
  abstract findById(id: string): Promise<SealedPiiRecordRow | null>;
  abstract update(id: string, patch: Partial<SealedPiiRecord>): Promise<SealedPiiRecordRow>;
  abstract delete(id: string): Promise<void>;

  /** Bir maskeleme haritasının tamamını tek seferde mühürlü olarak kaydeder. */
  abstract saveMany(records: SealedPiiRecord[]): Promise<SealedPiiRecordRow[]>;

  abstract findByDocument(documentId: string): Promise<SealedPiiRecordRow[]>;
  abstract findByUser(userId: string): Promise<SealedPiiRecordRow[]>;

  /** Bir belgeye ait tüm PII vault kayıtlarını siler (belge silindiğinde/GDPR). */
  abstract deleteByDocument(documentId: string): Promise<void>;

  /** GDPR Art.17 — süresi geçmiş kayıtları siler, silinen adedi döner. */
  abstract purgeExpired(now: Date): Promise<number>;
}

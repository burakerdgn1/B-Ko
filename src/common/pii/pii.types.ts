/**
 * PII maskeleme tipleri.
 *
 * Sözleşme (DECISIONS D-003): her benzersiz orijinal değer, kararlı bir yer
 * tutucuya («TYPE_n») eşlenir. Maskeli metin LLM'e gider; model çıktısındaki
 * yer tutucular yerelde geri çevrilir.
 */

export enum PiiEntityType {
  NAME = 'NAME',
  ADDRESS = 'ADDRESS',
  DOB = 'DOB',
  DATE = 'DATE',
  STEUERID = 'STEUERID',
  IBAN = 'IBAN',
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  AUSLNR = 'AUSLNR', // Ausländernummer
  AKTENZEICHEN = 'AKTENZEICHEN', // dosya/işlem numarası
  INSURANCE = 'INSURANCE', // Krankenversicherungsnummer
  PASSPORT = 'PASSPORT',
  POSTALCODE = 'POSTALCODE',
}

/** Maskeleme sırasında bulunan tek bir PII örneği. */
export interface PiiMatch {
  /** Orijinal (ham) değer — ASLA loglanmaz, ASLA düz persist edilmez. */
  original: string;
  /** Maskeli metindeki yer tutucu, ör. «NAME_1». */
  token: string;
  type: PiiEntityType;
  /** Eşleşmenin nasıl bulunduğu — denetim/teşhis için. */
  strategy: 'known-value' | 'pattern';
}

export interface PiiMap {
  /** token → orijinal değer. */
  readonly byToken: ReadonlyMap<string, PiiMatch>;
  /** Bulunan tüm eşleşmeler. */
  readonly matches: readonly PiiMatch[];
}

export interface MaskResult {
  /** LLM'e gitmesi güvenli metin. */
  maskedText: string;
  map: PiiMap;
  /** Kaç adet benzersiz PII değeri maskelendi. */
  count: number;
}

/**
 * Kullanıcının onboarding'de verdiği kendi PII değerleri.
 * "Bilinen-değer maskeleme" (yüksek recall) bunları kullanır.
 */
export interface KnownPiiProfile {
  fullName?: string;
  /** Ayrı ayrı da verilebilir (ad/soyad kombinasyonları için). */
  givenName?: string;
  familyName?: string;
  dateOfBirth?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  email?: string;
  phone?: string;
  auslaendernummer?: string;
  steuerId?: string;
  passportNumber?: string;
  insuranceNumber?: string;
  /** Serbest ek değerler (ör. eş/çocuk adları). */
  extra?: Array<{ value: string; type: PiiEntityType }>;
}

export interface MaskOptions {
  /** Bilinen-değer maskelemesi için kullanıcı profili. */
  profile?: KnownPiiProfile;
  /**
   * Yalnızca bu tipleri maskele (varsayılan: hepsi).
   * Not: kısıtlama yapmak recall'ü düşürür — dikkatli kullanın.
   */
  only?: PiiEntityType[];
}

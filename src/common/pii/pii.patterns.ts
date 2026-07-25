import { PiiEntityType } from './pii.types';

export interface PiiPattern {
  type: PiiEntityType;
  regex: RegExp;
  /**
   * Yakalanan grup indeksi. 0 = tüm eşleşme. Etiketli desenlerde
   * ("Aktenzeichen: X") yalnızca değeri maskelemek için 1 kullanılır.
   */
  group?: number;
  /** Ek doğrulama (checksum/uzunluk) — yanlış pozitifleri azaltır. */
  validate?: (value: string) => boolean;
}

const onlyDigits = (s: string) => s.replace(/\D/g, '');

/**
 * Steuer-ID (IdNr) doğrulaması: 11 hane; ilk 10 hanede tam olarak bir rakam
 * iki veya üç kez tekrar eder ve diğerleri en fazla bir kez görünür.
 * Tam ISO 7064 checksum'ı yerine bu yapısal kural, yanlış pozitifleri
 * (telefon/dosya no) elemede pratikte yeterli.
 */
function isPlausibleSteuerId(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 11) return false;
  if (d[0] === '0') return false;

  const counts = new Map<string, number>();
  for (const ch of d.slice(0, 10)) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  const repeated = [...counts.values()].filter((c) => c > 1);
  return counts.size >= 8 && repeated.length <= 1;
}

/** IBAN mod-97 checksum (ISO 13616). */
function isValidIban(raw: string): boolean {
  const iban = raw.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  );

  // Büyük sayı için parçalı mod-97.
  let remainder = 0;
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/**
 * Yapısal desen maskelemesi (DECISIONS D-003 adım 2).
 *
 * SIRA ÖNEMLİ: daha spesifik desenler önce gelir. Örn. IBAN, Steuer-ID'den
 * önce denenmelidir; aksi hâlde IBAN içindeki rakam dizisi yanlış eşleşir.
 */
export const PII_PATTERNS: PiiPattern[] = [
  // ── E-posta (en spesifik) ──
  {
    type: PiiEntityType.EMAIL,
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },

  // ── IBAN ──
  {
    type: PiiEntityType.IBAN,
    regex: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g,
    validate: isValidIban,
  },

  // ── Etiketli numaralar (etiket korunur, değer maskelenir) ──
  {
    type: PiiEntityType.AUSLNR,
    regex:
      /(?:Ausländernummer|Auslaendernummer|AZR-Nummer|ZAR-Nummer)\s*[:.]?\s*([A-Z0-9][A-Z0-9\-/ ]{4,20}[A-Z0-9])/gi,
    group: 1,
  },
  {
    type: PiiEntityType.AKTENZEICHEN,
    regex:
      /(?:Aktenzeichen|Az\.|Gesch\.-Z\.|Geschäftszeichen|Vorgangsnummer|Kundennummer)\s*[:.]?\s*([A-Z0-9][A-Z0-9\-/. ]{3,25}[A-Z0-9])/gi,
    group: 1,
  },
  {
    type: PiiEntityType.STEUERID,
    regex:
      /(?:Steuer-?(?:ID|Identifikationsnummer)|IdNr\.?|Steuernummer)\s*[:.]?\s*([\d ]{11,17})/gi,
    group: 1,
  },
  {
    type: PiiEntityType.INSURANCE,
    regex:
      /(?:Krankenversicherungsnummer|Versichertennummer|Sozialversicherungsnummer)\s*[:.]?\s*([A-Z]?[\d ]{8,14}[A-Z]?)/gi,
    group: 1,
  },
  {
    type: PiiEntityType.PASSPORT,
    regex:
      /(?:Passnummer|Reisepass(?:nummer)?|Ausweisnummer)\s*[:.]?\s*([A-Z0-9]{6,12})/gi,
    group: 1,
  },

  // ── Etiketsiz Steuer-ID (11 hane, yapısal doğrulamalı) ──
  {
    type: PiiEntityType.STEUERID,
    regex: /\b\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3}\b/g,
    validate: isPlausibleSteuerId,
  },

  // ── Telefon (Almanya + uluslararası) ──
  {
    type: PiiEntityType.PHONE,
    regex:
      /(?:(?:\+|00)49|\(0\)|\b0)[\s\-/]?\d{2,5}[\s\-/]?\d{3,9}(?:[\s\-/]?\d{1,6})?\b/g,
    validate: (v) => onlyDigits(v).length >= 7 && onlyDigits(v).length <= 15,
  },

  // ── PLZ + şehir (adres imzası) ──
  {
    type: PiiEntityType.ADDRESS,
    regex: /\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ][a-zäöüß]+)*/g,
  },

  // ── Sokak + kapı no ──
  {
    type: PiiEntityType.ADDRESS,
    regex:
      /\b[A-ZÄÖÜ][a-zäöüß]+(?:straße|strasse|str\.|weg|allee|platz|gasse|ring|damm|ufer)\s+\d{1,4}[a-zA-Z]?\b/g,
  },

  // ── Tarihler (DOB dâhil; deadline çıkarımı token üzerinden yapılır — D-009) ──
  {
    type: PiiEntityType.DATE,
    regex: /\b\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}\b/g,
  },
  {
    type: PiiEntityType.DATE,
    regex: /\b\d{4}-\d{2}-\d{2}\b/g,
  },
  {
    type: PiiEntityType.DATE,
    regex:
      /\b\d{1,2}\.\s?(?:Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+\d{4}\b/g,
  },
];

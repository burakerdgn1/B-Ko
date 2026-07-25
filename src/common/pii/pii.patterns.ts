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
/**
 * Bir isim öbeği: büyük harfle başlayan 1-3 sözcük.
 *
 * `\p{Lu}\p{L}*` (Unicode) kullanılır — Türkçe (Kılıç), Vietnamca (Nguyễn),
 * Arapça latinizasyonu (Al-Rashid) ve tireli/kesme işaretli adlar (O’Brien,
 * Müller-Schmidt) kapsansın diye. ASCII `[A-Z]` bunları KAÇIRIRDI.
 */
const NAME_PHRASE = String.raw`\p{Lu}[\p{L}'’\-]+(?:[ \t]+\p{Lu}[\p{L}'’\-]+){0,2}`;

/** Unvan öneki (yakalanan ada dâhil edilmez, sadece atlanır). */
const TITLE_PREFIX = String.raw`(?:(?:Dr|Prof|Dipl)\.[ \t]*(?:med\.[ \t]*|jur\.[ \t]*|Ing\.[ \t]*)?)?`;

/**
 * Tetikleyici ile ad arasındaki boşluk: EN FAZLA bir satır sonu.
 *
 * Alman mektuplarında adres bloğu sıklıkla iki satırdır ("Herrn\nMax Mustermann"),
 * bu yüzden tek satır sonuna izin veriyoruz. Ancak ad ÖBEĞİNİN KENDİSİ satır
 * atlayamaz (`NAME_PHRASE` içinde yalnızca yatay boşluk) — aksi hâlde satır
 * sonundaki bir ad, sonraki satırın ilk kelimesini de yutardı.
 */
const GAP = String.raw`[ \t]*\n?[ \t]*`;

/**
 * İsim gibi görünen ama İSİM OLMAYAN sözcükler.
 *
 * Almancada TÜM isimler (nouns) büyük harfle başlar; bu yüzden "büyük harf =
 * özel ad" sezgisi Almanca'da felaketle sonuçlanır. Tetikleyici desenler bu
 * riski büyük ölçüde azaltır, ancak "Sehr geehrte Damen und Herren" gibi
 * kalıplar yine de yakalanabilirdi — bu liste onları eler.
 */
const NOT_A_NAME = new Set(
  [
    'damen', 'herren', 'herr', 'frau', 'damen und herren',
    'doktor', 'professor', 'kollege', 'kollegin',
    'sachbearbeiter', 'sachbearbeiterin', 'ansprechpartner', 'ansprechpartnerin',
    'bearbeiter', 'bearbeiterin', 'mitarbeiter', 'mitarbeiterin',
    'antragsteller', 'antragstellerin', 'anwalt', 'anwältin',
    'rechtsanwalt', 'rechtsanwältin', 'behörde', 'amt', 'abteilung',
    'ausländerbehörde', 'bürgeramt', 'landeshauptstadt', 'stadt', 'gemeinde',
    'auftrag', 'vertretung', 'unterschrift', 'anlage', 'anlagen',
    'betreff', 'datum', 'seite', 'grüßen', 'hochachtungsvoll',
  ].map((w) => w.toLowerCase()),
);

/** Yakalanan öbeğin gerçekten bir ad olup olmadığını denetler. */
function isPlausiblePersonName(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3) return false;

  const words = trimmed.split(/\s+/);
  // Her sözcük stoplist'te olmamalı; tek sözcüklü öbekte de aynı kural.
  for (const word of words) {
    if (NOT_A_NAME.has(word.toLowerCase().replace(/[.,;:]$/, ''))) return false;
  }
  if (NOT_A_NAME.has(trimmed.toLowerCase())) return false;

  // Tamamı büyük harf ve tek sözcükse (ör. "ABTEILUNG") ad kabul etme.
  if (words.length === 1 && trimmed === trimmed.toUpperCase()) return false;

  return true;
}

/**
 * Üçüncü taraf kişi adları — BAĞLAMSAL TETİKLEYİCİ yaklaşımı (D-029, Faz A).
 *
 * Neden NER değil: bir ismin *biçimi* onu tanınabilir kılmaz, ama Alman resmî
 * yazışmasında isimlerin geçtiği BAĞLAMLAR son derece düzenlidir. Bu desenler
 * yalnızca o bağlamlarda eşleşir; dolayısıyla olasılıksal bir model olmadan,
 * deterministik ve denetlenebilir kalarak memur/aile üyesi adlarını yakalar.
 *
 * Kapsamadığı durum (bilinçli): hiçbir tetikleyici olmadan, metnin ortasında
 * geçen çıplak adlar. Onlar yerel NER gerektirir — v2 (D-028).
 */
const THIRD_PARTY_NAME_PATTERNS: PiiPattern[] = [
  // "Sehr geehrter Herr Yılmaz," / "Sehr geehrte Frau Nguyễn Thị Hồng,"
  {
    type: PiiEntityType.NAME,
    regex: new RegExp(
      String.raw`Sehr[ \t]+geehrte[rs]?[ \t]+(?:Herr|Frau)${GAP}${TITLE_PREFIX}(${NAME_PHRASE})`,
      'gu',
    ),
    group: 1,
    validate: isPlausiblePersonName,
  },

  // "Ihre Sachbearbeiterin: Frau Sabine Brandt" / "Ansprechpartner: Herr Meier"
  {
    type: PiiEntityType.NAME,
    regex: new RegExp(
      String.raw`(?:Sachbearbeiter(?:in)?|Ansprechpartner(?:in)?|Bearbeiter(?:in)?|` +
        String.raw`Sachgebietsleiter(?:in)?|Rechtsanwalt|Rechtsanwältin)[ \t]*[:.]?${GAP}` +
        String.raw`(?:Herr|Frau)?${GAP}${TITLE_PREFIX}(${NAME_PHRASE})`,
      'gu',
    ),
    group: 1,
    validate: isPlausiblePersonName,
  },

  // İmza blokları: "i. A. Brandt", "i.V. Müller", "gez. Schmidt"
  {
    type: PiiEntityType.NAME,
    regex: new RegExp(
      String.raw`(?:i\.[ \t]*[AV]\.|gez\.)${GAP}${TITLE_PREFIX}(${NAME_PHRASE})`,
      'gu',
    ),
    group: 1,
    validate: isPlausiblePersonName,
  },

  // Adres bloğu / metin içi hitap: "Herrn Yasin Kılıç", "Frau Elif Kılıç"
  {
    type: PiiEntityType.NAME,
    regex: new RegExp(
      String.raw`\b(?:Herrn|Herr|Frau)${GAP}${TITLE_PREFIX}(${NAME_PHRASE})`,
      'gu',
    ),
    group: 1,
    validate: isPlausiblePersonName,
  },

  // Aile bağı ifadeleri: "Ihrer Ehefrau Elif Kılıç", "Ihres Sohnes Ahmet"
  {
    type: PiiEntityType.NAME,
    regex: new RegExp(
      String.raw`(?:Ehefrau|Ehemann|Ehepartner(?:in)?|Sohn(?:es)?|Tochter|Kind(?:es)?|` +
        String.raw`Vater[s]?|Mutter)${GAP}${TITLE_PREFIX}(${NAME_PHRASE})`,
      'gu',
    ),
    group: 1,
    validate: isPlausiblePersonName,
  },
];

export const PII_PATTERNS: PiiPattern[] = [
  // ── Üçüncü taraf adları (bağlamsal tetikleyici — D-029) ──
  // En başta: bu desenler ETİKETLİ olduğu için daha spesifiktir ve adres/tarih
  // desenlerinin isim öbeğini parçalamasını önler.
  ...THIRD_PARTY_NAME_PATTERNS,

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

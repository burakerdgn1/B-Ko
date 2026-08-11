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
function isValidIbanExact(raw: string): boolean {
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
 * OCR'da harfe dönüşmesi beklenen rakamlar — yalnızca IBAN'ın SAYISAL
 * konumlarında (3. karakterden sonrası) geri çevrilir.
 *
 * Bir harf BİRDEN ÇOK rakama karşılık gelebilir: `g` hem `9` hem `6` okunmuş
 * olabilir (gözlenen vaka `DE94` → `DEg4`, yani `g`→`9`). Tek bir "doğru"
 * onarım seçmek yerine adayların HEPSİ denenir ve kararı mod-97 checksum'ı
 * verir. Bu, tahmin etmeyi değil, doğrulamayı esas alır.
 */
const IBAN_DIGIT_REPAIRS: Record<string, string[]> = {
  g: ['9', '6'], G: ['6', '9'],
  o: ['0'], O: ['0'], Q: ['0'], D: ['0'],
  l: ['1'], L: ['1'], I: ['1'], i: ['1'], '|': ['1'],
  s: ['5'], S: ['5'], B: ['8'], Z: ['2'], z: ['2'], T: ['7'], q: ['9'],
};

/** Onarım araması için üst sınır — kombinatoryal patlamayı engeller. */
const IBAN_MAX_REPAIR_SITES = 6;

/**
 * IBAN doğrulaması — OCR onarımı checksum'a TABİ (D-046).
 *
 * Gözlenen bozulma: `DE94 1007 …` → `DEg4 1007 …` (`9` → `g`). Ham eşleşme
 * hem regex'i hem checksum'ı düşürüyordu ve **IBAN maskelenmeden LLM'e
 * gidiyordu** (fixture 08: IBAN token 1 → 0).
 *
 * Buradaki tasarım bilinçli: harf↔rakam karışıklıklarını desene gömüp
 * kapsamı genişletmek yerine, aday dizeyi ONARIP mod-97'ye doğrulatıyoruz.
 * Checksum, yanlış pozitif savunmasının TAMAMI — gevşetilmez. Rastgele bir
 * karakter dizisinin onarımdan sonra mod-97'yi tutturma olasılığı ~1/97'dir
 * ve onarım yalnızca sabit bir karışıklık tablosunu uygular, serbest arama
 * yapmaz. Yani kapsam artar, kesinlik düşmez.
 */
function isValidIban(raw: string): boolean {
  if (isValidIbanExact(raw)) return true;

  const compact = raw.replace(/[\s-]/g, '');
  if (compact.length < 5) return false;

  // İlk 2 karakter ülke kodu — harf kalmalı, onarılmaz.
  const head = compact.slice(0, 2).toUpperCase();
  const body = [...compact.slice(2)];

  const sites = body
    .map((c, i) => (IBAN_DIGIT_REPAIRS[c] ? i : -1))
    .filter((i) => i >= 0);

  if (sites.length === 0 || sites.length > IBAN_MAX_REPAIR_SITES) return false;

  // Her onarım noktasında "olduğu gibi bırak" + aday rakamlar denenir.
  const options = sites.map((i) => [body[i], ...IBAN_DIGIT_REPAIRS[body[i]]]);

  const total = options.reduce((acc, o) => acc * o.length, 1);
  for (let n = 0; n < total; n++) {
    const candidate = [...body];
    let rest = n;
    for (let s = 0; s < sites.length; s++) {
      const opt = options[s];
      candidate[sites[s]] = opt[rest % opt.length];
      rest = Math.floor(rest / opt.length);
    }
    if (isValidIbanExact(head + candidate.join('').toUpperCase())) return true;
  }
  return false;
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
    // Kontrol haneleri ve gövde, OCR'da harfe dönüşmüş rakamları da kabul
    // eder (`DEg4…`). Bu genişletme kesinliği DÜŞÜRMEZ: `validate` mod-97
    // checksum'ını uygular ve onarılmış aday da checksum'dan geçmek
    // zorundadır (D-046).
    regex:
      /\b[A-Z]{2}[\dGgOoQDLlIi|SsBZzTq]{2}(?:[ ]?[A-Z0-9gioqdlszt|]{4}){2,7}(?:[ ]?[A-Z0-9gioqdlszt|]{1,4})?\b/g,
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
  // Şehir adları da OCR'dan bozuk çıkar (`Düsseldorf` → `Diisseldorf`);
  // harf sınıfları buna göre genişletildi (D-046).
  {
    type: PiiEntityType.ADDRESS,
    regex:
      /\b\d{5}\s+[A-ZÄÖÜÀÁÉÓÚ][a-zäöüßàáéóúâôû]+(?:[ -][A-ZÄÖÜÀÁÉÓÚ][a-zäöüßàáéóúâôû]+)*/g,
  },

  // ── Sokak + kapı no ──
  //
  // OCR toleransı (D-046): tesseract `ß`'yi `B` okur, yani `Amtsstraße 5`
  // belgede `AmtsstraBe 5` olarak durur. Sabit `straße|strasse` alternasyonu
  // bunu kaçırıyordu ve KURUM adresi maskelenmeden LLM'e gidiyordu — bilinen
  // değer maskelemesi bu adresi kapsamaz (kullanıcının kendi adresi değil).
  //
  // Gövde harf sınıfına da bozulmuş biçimler eklendi: aksan düşmesi/kayması
  // (`ä`→`a`,`à`) ve `ü`→`ii` (D-044'te `Düsseldorf`→`Diisseldorf` gözlendi).
  //
  // Tireli/çok parçalı sokak adları (D-046): `Karl-Marx-Allee`,
  // `Rosa-Luxemburg-Straße`, `Ernst-Reuter-Platz` Almanya'da çok yaygın ve
  // eski desen bunları HİÇ yakalamıyordu — iki sebeple: (a) gövde sınıfı
  // ilk harften sonra büyük harf kabul etmiyordu, (b) son ek alternasyonu
  // yalnızca küçük harfliydi, oysa tireli adlarda ek de büyük harfle başlar
  // (`-Allee`). Bu OCR'dan bağımsız, ÖNCEDEN VAR OLAN bir boşluktu; OCR
  // ölçümünün artık taraması ortaya çıkardı (fixture 06).
  {
    type: PiiEntityType.ADDRESS,
    // Kapı numarası da OCR toleranslıdır: gözlenen vaka `Ottmar-Pohl-Platz 1`
    // → `Ottmar-Pohl-Platz ı` (rakam `1`, Türkçe noktasız `ı` okundu).
    // İki alternatif: (a) en az BİR gerçek rakam içeren kısa dizi,
    // (b) tek bir rakam-benzeri glif. (a)'daki "en az bir rakam" şartı
    // `Straße Berlin` gibi yanlış eşleşmeleri eler.
    //
    // Sonlandırıcı `\b` DEĞİL `(?![A-Za-z0-9])`: JS'te `\b` ASCII tabanlıdır,
    // `ı` (U+0131) kelime karakteri sayılmaz ve `\b` satır sonunda tutmazdı —
    // yani düzeltme sessizce etkisiz kalırdı.
    regex:
      /\b[A-ZÄÖÜÀÁÉÓÚ][a-zäöüßàáéóúâôû]*(?:-[A-ZÄÖÜÀÁÉÓÚ]?[a-zäöüßàáéóúâôû]+)*-?(?:[Ss]tra(?:ß|ss|B|b|fs)e|[Ss]tr\.|[Ww]eg|[Aa]llee|[Pp]latz|[Gg]asse|[Rr]ing|[Dd]amm|[Uu]fer)\s+(?:[\dOolIiı|SsBZzGgq]{0,3}\d[\dOolIiı|SsBZzGgq]{0,3}|[OolIiı|SsBZzGgq])[a-zA-Z]?(?![A-Za-z0-9])/g,
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

/**
 * ════════════════════════════════════════════════════════════════════════════
 * OCR bozulmalarına dayanıklı eşleşme (D-046 · D-044'ün ön koşulu)
 *
 * SORUN: bilinen-değer maskelemesi TAM EŞLEŞME yapar. OCR'dan geçmiş bir
 * belgede kullanıcının kendi adresi `Torstraße 15` değil `TorstraBe 15` olarak
 * durur — eşleşme tutmaz ve **kullanıcının adresi maskelenmeden LLM'e gider.**
 * Hiçbir hata üretmez; sessizdir. D-044 bunu ölçtü ve `OCR_PROVIDER=local`
 * geçişini bu yüzden bloke etti.
 *
 * ÇÖZÜM: eşleşmeyi karakter düzeyinde genişletmek. Her karakter, OCR'ın onu
 * karıştırabildiği biçimlerin alternasyonuna açılır (`ß` → `(?:ß|ss|B|b|fs)`).
 *
 * ── Neden bu yön güvenli? ───────────────────────────────────────────────────
 * Genişletme yalnızca DAHA ÇOK eşleşme üretir, daha az değil. PII maskelemesi
 * için hata yönü asimetriktir:
 *   - kaçırma (false negative) = kimlik bilgisi sağlayıcıya gider → GERÇEK ZARAR
 *   - fazla maskeleme (false positive) = metin okunaksızlaşır → analiz kalitesi düşer
 * Yani kararsız kaldığımız yerde maskelemek doğru varsayılandır. Ama fazla
 * maskeleme de bedelsiz değil: `pii.fixtures.spec.ts` token/kelime oranını
 * %15'in altında tutmayı ve alan terimlerinin NAME sayılmamasını zorunlu kılar.
 * Bu iki test, buradaki genişletmenin üst sınırıdır.
 *
 * ── Kapsam sınırı (bilinçli) ────────────────────────────────────────────────
 * Bu tablo tesseract'ın Almanca metinde GÖZLENEN hatalarına dayanır
 * (`scripts/ocr-mask-bench.ts` ile gerçek çıktı üzerinde ölçüldü), tam bir OCR
 * hata modeli değildir. Karakter EKLEME/SİLME (ör. `Torstra Be`) kapsanmaz —
 * onun için hizalama tabanlı bir yaklaşım gerekir; bugünkü ölçümde ihtiyaç
 * görülmedi. `scripts/ocr-mask-bench.ts` içindeki Levenshtein artık taraması
 * tam da bu kalan boşluğu bağımsız olarak izler.
 * ════════════════════════════════════════════════════════════════════════════
 */

/**
 * Çok karakterli karışıklıklar — TEK karakterlerden ÖNCE denenir.
 *
 * Almanca'nın kendi yazım varyantları da buradadır (`ss` ↔ `ß`, `ae` ↔ `ä`):
 * kullanıcı onboarding'de `Strasse` yazmış olabilir, belgede `Straße` geçer.
 * Bu, OCR'dan bağımsız olarak da gerçek bir kaçırma sebebiydi.
 */
/** Türkçe i-ailesi (D-011) — OCR toleransı kapalıyken bile katlanır. */
const I_FAMILY = ['i', 'ı', 'I', 'İ'];

const DIGRAPHS: Record<string, string[]> = {
  ss: ['ss', 'ß', 'B', 'fs'],
  ae: ['ae', 'ä'],
  oe: ['oe', 'ö'],
  ue: ['ue', 'ü'],
  // Klasik OCR birleşmesi: bitişik `r`+`n` tek bir `m` gibi okunur.
  rn: ['rn', 'm'],
};

/**
 * Tek karakter karışıklıkları.
 *
 * Umlaut satırları iki yönlüdür: tesseract hem aksanı DÜŞÜRÜR (`ä` → `a`) hem
 * de BAŞKA bir aksanla karıştırır (D-044: `Ausländerbehörde` → `Auslanderbehérde`).
 */
const CONFUSIONS: Record<string, string[]> = {
  // ── Almanca'ya özgü ──
  ß: ['ß', 'ss', 'B', 'b', 'fs', '13'],
  ä: ['ä', 'a', 'ae', 'à', 'á', 'â', 'ã'],
  ö: ['ö', 'o', 'oe', 'é', 'ó', 'ò', 'ô', '0'],
  ü: ['ü', 'u', 'ue', 'ù', 'ú', 'û', 'ii'],

  // ── Rakam ↔ harf (düşük çözünürlük/gölge) ──
  '0': ['0', 'O', 'o', 'Q', 'D'],
  // `ı` (U+0131) ŞART: gözlenen vaka `Ottmar-Pohl-Platz 1` → `…Platz ı`.
  // i-ailesi girdilerine `1` eklenmişti ama tersi eksikti — tablo simetrik
  // olmadığı için bilinen-değer eşleşmesi bu yönü kaçırıyordu.
  '1': ['1', 'l', 'I', 'i', 'ı', '|'],
  '2': ['2', 'Z', 'z'],
  '5': ['5', 'S', 's'],
  '6': ['6', 'G', 'b'],
  '7': ['7', 'T'],
  '8': ['8', 'B'],
  '9': ['9', 'g', 'q'],

  // ── Harf ↔ rakam (ters yön) ──
  O: ['O', '0', 'Q', 'D'],
  S: ['S', '5'],
  B: ['B', '8', 'ß'],
  G: ['G', '6'],
  Z: ['Z', '2'],
  l: ['l', '1', 'I', '|'],

  /**
   * Türkçe i-ailesi (D-011) — OCR'dan ÖNCE de gerekliydi ve korunmalıdır.
   * Unicode case-folding noktasız `ı` (U+0131) ile `I`'yı eşleştirmez; `/i`
   * bayrağı tek başına "Yılmaz" ↔ "YILMAZ" eşleşmesini kaçırır. Türk
   * kullanıcılar bu ürünün ana hedef kitlesinde. Buraya OCR karışıklıkları
   * (`1`, `l`) da eklendi.
   */
  i: ['i', 'ı', 'I', 'İ', '1', 'l', '|'],
  ı: ['ı', 'i', 'I', 'İ', '1', 'l', '|'],
  I: ['I', 'i', 'ı', 'İ', '1', 'l', '|'],
  İ: ['İ', 'I', 'i', 'ı', '1', 'l', '|'],
};

/**
 * OCR toleransının uygulandığı en kısa değer uzunluğu.
 *
 * Kısa değerlerde genişletme yanlış pozitif üretir: 3 harflik bir ad
 * (`Ali`) `1`/`l`/`I` genişlemesiyle metnin her yerine tutunabilir ve belgeyi
 * okunaksız bırakır. Uzun değerlerde ise tüm dizinin eşleşmesi gerektiği için
 * rastlantısal eşleşme olasılığı hızla düşer.
 */
export const OCR_TOLERANCE_MIN_LENGTH = 5;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function alternation(variants: string[]): string {
  // Uzun alternatifler önce: `ss` `s`'ten önce denenmeli, aksi hâlde regex
  // kısa olanı seçip kalan karakteri sonraki adıma bırakır.
  const sorted = [...new Set(variants)].sort((a, b) => b.length - a.length);
  return `(?:${sorted.map(escapeRegex).join('|')})`;
}

/**
 * Bir literal değeri, OCR bozulmalarına toleranslı bir regex kaynağına çevirir.
 *
 * Boşluklar `\s+`e açılır (satır kırılmaları/çoklu boşluk için — mevcut
 * davranış korunur). Değer `OCR_TOLERANCE_MIN_LENGTH`'ten kısaysa tolerans
 * uygulanmaz; yalnızca i-ailesi katlaması ve boşluk toleransı kalır.
 *
 * ÖNEMLİ: genişletme HAM değer üzerinde, karakter karakter yürüyerek yapılır —
 * önce `escapeRegex()` uygulayıp sonra sonucu string olarak değiştirmek
 * ölümcül bir hata olurdu: `\s+` içindeki `s` de genişletilir ve regex
 * `\(?:ss|ß|B|fs)+` hâline gelip bozulurdu.
 */
export function ocrTolerantSource(value: string): string {
  const applyTolerance = value.length >= OCR_TOLERANCE_MIN_LENGTH;
  let out = '';
  let i = 0;

  while (i < value.length) {
    const ch = value[i];

    // Boşluk dizisi → \s+
    if (/\s/.test(ch)) {
      out += '\\s+';
      while (i < value.length && /\s/.test(value[i])) i++;
      continue;
    }

    if (applyTolerance) {
      const digraph = value.slice(i, i + 2).toLowerCase();
      const digraphVariants = DIGRAPHS[digraph];
      if (digraphVariants && i + 2 <= value.length) {
        out += alternation(digraphVariants);
        i += 2;
        continue;
      }
    }

    const variants = applyTolerance
      ? CONFUSIONS[ch] ?? CONFUSIONS[ch.toLowerCase()] ?? CONFUSIONS[ch.toUpperCase()]
      : // Tolerans kapalıyken bile i-ailesi katlaması KALIR (D-011).
        I_FAMILY.includes(ch)
        ? I_FAMILY
        : undefined;

    out += variants ? alternation(variants) : escapeRegex(ch);
    i++;
  }

  return out;
}

/**
 * `ocrTolerantSource` ile hazırlanmış, global + case-insensitive bir regex.
 * `u` bayrağı BİLİNÇLİ OLARAK kullanılmaz: unicode modunda kimlik kaçışları
 * kısıtlıdır ve alternasyonlara giren `|`, `.` gibi karakterler için gereksiz
 * kırılganlık yaratır.
 */
export function ocrTolerantRegex(value: string): RegExp {
  return new RegExp(ocrTolerantSource(value), 'gi');
}

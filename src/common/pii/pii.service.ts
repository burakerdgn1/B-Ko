import { Injectable, Logger } from '@nestjs/common';
import { PII_PATTERNS } from './pii.patterns';
import {
  KnownPiiProfile,
  MaskOptions,
  MaskResult,
  PiiEntityType,
  PiiMap,
  PiiMatch,
} from './pii.types';

/** Yer tutucu biçimi: `[[TYPE_n]]` (bkz. DECISIONS D-008). */
const TOKEN_RE = /\[\[([A-Z]+)_(\d+)\]\]/g;
const TOKEN_OPEN = '[[';
const TOKEN_CLOSE = ']]';

interface Candidate {
  start: number;
  end: number;
  original: string;
  type: PiiEntityType;
  strategy: PiiMatch['strategy'];
}

/**
 * PII maskeleme servisi — projenin güvenlik moat'ı (DECISIONS D-003).
 *
 * Sözleşme:
 *   1. `mask()` çıktısındaki metin LLM'e gitmeye güvenlidir: hiçbir orijinal
 *      PII substring'i içermez (test ile invaryant olarak doğrulanır).
 *   2. `unmask()` round-trip'i kayıpsızdır: unmask(mask(x)) === x.
 *   3. Eşleme tablosu yalnızca process içinde tutulur; kalıcılaştırılacaksa
 *      CryptoService ile şifrelenir (pii_vault).
 */
@Injectable()
export class PiiService {
  private readonly logger = new Logger(PiiService.name);

  /**
   * Metni maskeler.
   *
   * Strateji sırası (recall için kritik):
   *   1. Bilinen-değer (kullanıcının kendi PII'si) — en riskli veri, en yüksek öncelik.
   *   2. Yapısal desenler (regex).
   * Çakışan eşleşmelerde daha uzun olan kazanır; eşitlikte bilinen-değer öncelikli.
   */
  mask(text: string, options: MaskOptions = {}): MaskResult {
    if (!text) {
      return { maskedText: '', map: emptyMap(), count: 0 };
    }

    // Güvenlik: girdide zaten yer tutucu benzeri diziler varsa etkisizleştir.
    // Aksi hâlde kötü niyetli/şanssız bir belge, unmask sırasında başka bir
    // kullanıcının token'ına enjeksiyon yapabilirdi.
    const sanitized = this.neutralizeExistingTokens(text);

    const allowed = options.only ? new Set(options.only) : null;
    const candidates: Candidate[] = [
      ...this.findKnownValues(sanitized, options.profile),
      ...this.findPatterns(sanitized),
    ].filter((c) => !allowed || allowed.has(c.type));

    // Bir değer belgede bir kez PII olarak tanındıysa, AYNI değerin diğer tüm
    // geçişleri de maskelenmelidir — bağlam etiketi olmasa bile. (Bkz. D-013)
    const resolved = this.resolveOverlaps(
      this.propagateFoundValues(sanitized, this.resolveOverlaps(candidates)),
    );

    // Aynı orijinal değer → aynı token (deterministik tokenizasyon).
    const tokenByValue = new Map<string, string>();
    const counters = new Map<PiiEntityType, number>();
    const byToken = new Map<string, PiiMatch>();

    let out = '';
    let cursor = 0;

    for (const c of resolved) {
      const key = `${c.type}::${normalizeKey(c.original)}`;
      let token = tokenByValue.get(key);

      if (!token) {
        const n = (counters.get(c.type) ?? 0) + 1;
        counters.set(c.type, n);
        token = `${TOKEN_OPEN}${c.type}_${n}${TOKEN_CLOSE}`;
        tokenByValue.set(key, token);
        byToken.set(token, {
          original: c.original,
          token,
          type: c.type,
          strategy: c.strategy,
        });
      }

      out += sanitized.slice(cursor, c.start) + token;
      cursor = c.end;
    }
    out += sanitized.slice(cursor);

    const matches = [...byToken.values()];
    this.logger.debug(
      `PII maskelendi: ${matches.length} benzersiz değer, ${resolved.length} örnek ` +
        `(tipler: ${[...counters.keys()].join(', ') || 'yok'})`,
    );

    return { maskedText: out, map: { byToken, matches }, count: matches.length };
  }

  /**
   * Maskeli metindeki yer tutucuları orijinal değerlerle değiştirir.
   * Bilinmeyen token'lar olduğu gibi bırakılır (model uydurmuş olabilir).
   */
  unmask(masked: string, map: PiiMap): string {
    if (!masked) return '';
    return masked.replace(TOKEN_RE, (full) => map.byToken.get(full)?.original ?? full);
  }

  /** Nesne/dizi içindeki tüm string alanları özyinelemeli olarak unmask eder. */
  unmaskDeep<T>(value: T, map: PiiMap): T {
    if (typeof value === 'string') return this.unmask(value, map) as unknown as T;
    if (Array.isArray(value)) {
      return value.map((v) => this.unmaskDeep(v, map)) as unknown as T;
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.unmaskDeep(v, map);
      }
      return out as T;
    }
    return value;
  }

  /**
   * İnvaryant denetimi: maskeli metinde hiçbir orijinal PII değeri kalmamalı.
   * LLM'e giden her yükte çağrılır (LlmService) — sessiz sızıntıya karşı son savunma.
   *
   * @returns sızan değerlerin *tiplerini* döner (değerin kendisi ASLA loglanmaz).
   */
  detectLeaks(maskedText: string, map: PiiMap): PiiEntityType[] {
    const haystack = normalizeKey(maskedText);
    const leaked = new Set<PiiEntityType>();

    for (const m of map.matches) {
      const needle = normalizeKey(m.original);
      // Çok kısa değerler (≤3 karakter) substring gürültüsü üretir; atlanır.
      if (needle.length <= 3) continue;
      if (haystack.includes(needle)) leaked.add(m.type);
    }
    return [...leaked];
  }

  /** Bir metnin yer tutucu içerip içermediği (teşhis/test için). */
  containsTokens(text: string): boolean {
    TOKEN_RE.lastIndex = 0;
    return TOKEN_RE.test(text);
  }

  // ── iç yardımcılar ────────────────────────────────────────────────────────

  private neutralizeExistingTokens(text: string): string {
    return text.replace(TOKEN_RE, (m) => m.replace(/\[\[|\]\]/g, '⟦⟧'));
  }

  /**
   * Bilinen-değer maskeleme (D-003 adım 1).
   * Kullanıcının kendi PII'si belgede birebir/normalize geçtiğinde yakalanır.
   */
  private findKnownValues(
    text: string,
    profile?: KnownPiiProfile,
  ): Candidate[] {
    if (!profile) return [];

    const entries: Array<{ value: string; type: PiiEntityType }> = [];
    const push = (value: string | undefined, type: PiiEntityType) => {
      if (value && value.trim().length >= 2) {
        entries.push({ value: value.trim(), type });
      }
    };

    push(profile.fullName, PiiEntityType.NAME);
    push(profile.givenName, PiiEntityType.NAME);
    push(profile.familyName, PiiEntityType.NAME);

    // Tam adın PARÇALARI da ayrı ayrı maskelenmeli.
    //
    // Neden kritik: Alman resmi mektupları kişiye neredeyse her zaman yalnızca
    // SOYADIYLA hitap eder ("Sehr geehrter Herr Yılmaz"). Onboarding'de çoğu
    // kullanıcı tek bir "tam ad" alanı doldurur; parçalara ayırmazsak
    // selamlamadaki soyadı maskelenmeden LLM'e giderdi. (D-015)
    for (const part of splitNameParts(profile.fullName)) {
      push(part, PiiEntityType.NAME);
    }
    push(profile.dateOfBirth, PiiEntityType.DOB);
    push(profile.address, PiiEntityType.ADDRESS);
    push(profile.city, PiiEntityType.ADDRESS);
    push(profile.postalCode, PiiEntityType.POSTALCODE);
    push(profile.email, PiiEntityType.EMAIL);
    push(profile.phone, PiiEntityType.PHONE);
    push(profile.auslaendernummer, PiiEntityType.AUSLNR);
    push(profile.steuerId, PiiEntityType.STEUERID);
    push(profile.passportNumber, PiiEntityType.PASSPORT);
    push(profile.insuranceNumber, PiiEntityType.INSURANCE);
    for (const e of profile.extra ?? []) push(e.value, e.type);

    // "Ad Soyad" verildiyse ters sırayı ("Soyad, Ad") da ara.
    if (profile.givenName && profile.familyName) {
      entries.push({
        value: `${profile.familyName}, ${profile.givenName}`,
        type: PiiEntityType.NAME,
      });
      entries.push({
        value: `${profile.familyName} ${profile.givenName}`,
        type: PiiEntityType.NAME,
      });
    }

    // Uzun değerler önce → "Ahmet Yılmaz", "Ahmet"ten önce eşleşir.
    entries.sort((a, b) => b.value.length - a.value.length);

    const out: Candidate[] = [];
    for (const { value, type } of entries) {
      // Boşluk toleransı: belgedeki satır kırılmaları/çoklu boşluklar için.
      const pattern = new RegExp(
        foldLocaleCase(escapeRegex(value).replace(/\\?\s+/g, '\\s+')),
        'giu',
      );
      for (const m of text.matchAll(pattern)) {
        if (m.index === undefined) continue;
        out.push({
          start: m.index,
          end: m.index + m[0].length,
          original: m[0],
          type,
          strategy: 'known-value',
        });
      }
    }
    return out;
  }

  private findPatterns(text: string): Candidate[] {
    const out: Candidate[] = [];

    for (const p of PII_PATTERNS) {
      const re = new RegExp(p.regex.source, p.regex.flags);
      for (const m of text.matchAll(re)) {
        if (m.index === undefined) continue;

        const groupIdx = p.group ?? 0;
        const value = m[groupIdx];
        if (!value) continue;

        // Etiketli desenlerde yalnızca değerin ofsetini hesapla.
        const offsetInMatch = groupIdx === 0 ? 0 : m[0].indexOf(value);
        if (offsetInMatch < 0) continue;

        const trimmed = value.trimEnd();
        if (p.validate && !p.validate(trimmed)) continue;

        out.push({
          start: m.index + offsetInMatch,
          end: m.index + offsetInMatch + trimmed.length,
          original: trimmed,
          type: p.type,
          strategy: 'pattern',
        });
      }
    }
    return out;
  }

  /**
   * Bulunan her PII değerinin belgedeki DİĞER geçişlerini de aday listesine ekler.
   *
   * Neden gerekli (D-013): desen maskelemesi bağlam etiketine dayanır
   * ("Aktenzeichen: X"). Aynı değer başka bir etiketle tekrar geçtiğinde
   * ("Verwendungszweck: X") etiket eşleşmez ve değer MASKELENMEDEN LLM'e giderdi.
   * Bu, gerçek bir sızıntıydı — sentetik Gebührenbescheid fixture'ı ile yakalandı.
   *
   * Kural: bir değer belgede bir kez PII olarak tanındıysa, o değerin tüm
   * geçişleri PII'dir. Bağlam bir kez kanıt sağlar; sonrası değerin kendisidir.
   */
  private propagateFoundValues(
    text: string,
    found: Candidate[],
  ): Candidate[] {
    if (found.length === 0) return found;

    // Aynı değer birden çok tip altında görünebilir; ilk (en güçlü) tip kazanır.
    const typeByValue = new Map<string, PiiEntityType>();
    for (const c of found) {
      const key = normalizeKey(c.original);
      // Çok kısa değerler ("Am", "Zu") belge genelinde gürültü üretir.
      if (key.length <= 3) continue;
      if (!typeByValue.has(key)) typeByValue.set(key, c.type);
    }

    const extra: Candidate[] = [];
    for (const [key, type] of typeByValue) {
      // Orijinal yazımı koru: normalize edilmiş anahtar yerine gerçek eşleşmeyi ara.
      const source = found.find((c) => normalizeKey(c.original) === key);
      if (!source) continue;

      const pattern = new RegExp(
        foldLocaleCase(escapeRegex(source.original).replace(/\\?\s+/g, '\\s+')),
        'giu',
      );
      for (const m of text.matchAll(pattern)) {
        if (m.index === undefined) continue;
        extra.push({
          start: m.index,
          end: m.index + m[0].length,
          original: m[0],
          type,
          strategy: source.strategy,
        });
      }
    }

    return [...found, ...extra];
  }

  /**
   * Çakışan aday eşleşmeleri teke indirir.
   * Öncelik: (1) daha erken başlangıç, (2) daha uzun eşleşme,
   * (3) bilinen-değer stratejisi.
   */
  private resolveOverlaps(candidates: Candidate[]): Candidate[] {
    const sorted = [...candidates].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      const lenDiff = b.end - b.start - (a.end - a.start);
      if (lenDiff !== 0) return lenDiff;
      if (a.strategy !== b.strategy) return a.strategy === 'known-value' ? -1 : 1;
      return 0;
    });

    const kept: Candidate[] = [];
    let lastEnd = -1;
    for (const c of sorted) {
      if (c.start < lastEnd) continue; // çakışıyor → atla
      kept.push(c);
      lastEnd = c.end;
    }
    return kept;
  }
}

function emptyMap(): PiiMap {
  return { byToken: new Map(), matches: [] };
}

/**
 * Tam adı bağımsız olarak maskelenebilir parçalara ayırır.
 *
 * Atlanan parçalar:
 *   - 3 karakterden kısa olanlar (baş harf, "Dr" vb.) — belge genelinde
 *     yanlış eşleşme gürültüsü üretirler.
 *   - Ad bağlaçları/unvanlar — bunlar tek başına kimlik belirtmez, ama
 *     maskelenirlerse metin okunamaz hâle gelir.
 */
function splitNameParts(fullName?: string): string[] {
  if (!fullName) return [];

  const PARTICLES = new Set([
    'van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'dos',
    'bin', 'ibn', 'al', 'el', 'abu', 'ait', 'ben',
    'dr', 'prof', 'herr', 'frau', 'mr', 'mrs', 'ms',
  ]);

  return fullName
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3 && !PARTICLES.has(p.toLowerCase()));
}

/** Karşılaştırma için normalizasyon: NFKC + küçük harf + boşluk sıkıştırma. */
function normalizeKey(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Yerel-dile bağlı büyük/küçük harf eşleşmesini düzeltir.
 *
 * Unicode case-folding, Türkçe noktasız `ı` (U+0131) ile `I`'yı EŞLEŞTİRMEZ;
 * `/i` bayrağı tek başına "Yılmaz" ↔ "YILMAZ" eşleşmesini kaçırır. Türk
 * kullanıcılar bu ürünün ana hedef kitlesinde olduğundan bu, kabul edilemez
 * bir recall kaybıdır — i-ailesi karakterleri karakter sınıfına genişletilir.
 * Aynı sorun Azerice/Kazakça isimlerde de görülür.
 */
function foldLocaleCase(pattern: string): string {
  return pattern.replace(/[iıIİ]/g, '[iıIİ]');
}

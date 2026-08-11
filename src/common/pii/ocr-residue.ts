/**
 * ════════════════════════════════════════════════════════════════════════════
 * Bulanık sızıntı taraması — maskelemeden BAĞIMSIZ doğrulama oracle'ı (D-046)
 *
 * `PiiService.detectLeaks()` TAM alt dize araması yapar ve maskeleme
 * mantığıyla aynı normalizasyonu paylaşır. OCR dünyasında bu yetmez:
 * `Mönckebergstraße 7` maskelenmeden kalıp belgede `MénckebergstraBe 7`
 * olarak durursa `detectLeaks` bunu GÖRMEZ — ama o dize hâlâ tanınabilir bir
 * adrestir ve LLM'e gitmemelidir.
 *
 * Bu modül o boşluğu kapatan bağımsız ölçüyü sağlar: standart Levenshtein
 * mesafesi. BİLEREK maskeleme kurallarını (bkz. `ocr-tolerance.ts`) kullanmaz —
 * amacı tam da o kuralların KAÇIRDIKLARINI yakalamaktır. Aynı varsayımları
 * paylaşan bir doğrulayıcı hiçbir şey doğrulamaz; bu projede aracın kendisinin
 * yanıldığı dört vaka var (D-033, D-039, D-041 ve teşhis script'i).
 *
 * ⚠️ İSTEK YOLUNDA KULLANILMAZ. Kayan pencere taraması O(metin × değer × pencere)
 * maliyetindedir; burası doğrulama/ölçüm içindir (`pii.ocr-resilience.spec.ts`
 * ve `scripts/ocr-mask-bench.ts`). Üretimdeki sızıntı savunması
 * `PiiService.detectLeaks()`'tir.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** Klasik iki satırlı (rolling) Levenshtein — O(n·m) zaman, O(m) bellek. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** 0..1 arası benzerlik (1 = birebir aynı). */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

/**
 * Bu eşiğin üstündeki bir pencere "tanınabilir artık" sayılır.
 *
 * %80, gözlenen en kötü OCR bozulmasının (`Düsseldorf` → `Diisseldorf`, %82)
 * altında kalacak şekilde seçildi — yani gerçek bozulmalar yakalanır. Daha
 * düşük bir eşik alakasız Almanca sözcükleri de işaretlemeye başlar.
 */
export const RESIDUE_THRESHOLD = 0.8;

export interface ResidueHit {
  /** Aranan orijinal PII değeri. */
  value: string;
  /** Maskeli metinde ona en çok benzeyen pencere. */
  window: string;
  /** 0..1 benzerlik. */
  score: number;
}

/**
 * Maskeli metinde `value`'ya `RESIDUE_THRESHOLD` kadar benzeyen bir pencere
 * arar. Yer tutucular taramadan önce çıkarılır — `[[ADDRESS_1]]` artık değildir.
 *
 * Pencere uzunluğu ±%25 aralığında taranır: OCR karakter ekleyip silebildiği
 * için artığın uzunluğu orijinalle birebir aynı olmayabilir.
 */
export function findResidue(masked: string, value: string): ResidueHit | null {
  const hay = masked.replace(/\[\[[A-Z]+_\d+\]\]/g, ' ');
  const lowerHay = hay.toLowerCase();
  const needle = value.toLowerCase();
  const w = value.length;

  // ── Ucuz ön eleme ─────────────────────────────────────────────────────────
  // Levenshtein O(len²)'dir ve her konum için hesaplanırsa tarama çok yavaşlar
  // (14 mektup × ~10 değer ile 30 sn'yi aşıyordu). Ön eleme GEREKLİ koşula
  // dayanır, dolayısıyla yanlış NEGATİF üretmez:
  //   needle'da hiç geçmeyen her karakter en az 1 düzenleme maliyetidir,
  //   yani  lev ≥ len − (pencerede needle karakterlerinden olanların sayısı).
  // similarity ≥ T  ⇔  lev ≤ (1−T)·max(len, w)  olduğundan, bu alt sınır
  // eşiği aşan pencereler Levenshtein hesaplanmadan elenebilir.
  const needleChars = new Set(needle);
  const prefix = new Int32Array(lowerHay.length + 1);
  for (let i = 0; i < lowerHay.length; i++) {
    prefix[i + 1] = prefix[i] + (needleChars.has(lowerHay[i]) ? 1 : 0);
  }

  let best: ResidueHit | null = null;

  for (let len = Math.max(4, Math.floor(w * 0.75)); len <= Math.ceil(w * 1.25); len++) {
    const budget = (1 - RESIDUE_THRESHOLD) * Math.max(len, w);
    for (let i = 0; i + len <= lowerHay.length; i++) {
      const shared = prefix[i + len] - prefix[i];
      if (len - shared > budget) continue; // eşiği tutturması imkânsız

      const score = similarity(lowerHay.slice(i, i + len), needle);
      if (score >= RESIDUE_THRESHOLD && (!best || score > best.score)) {
        best = { value, window: hay.slice(i, i + len), score };
      }
    }
  }
  return best;
}

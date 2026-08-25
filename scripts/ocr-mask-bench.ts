/**
 * ════════════════════════════════════════════════════════════════════════════
 * OCR ↔ maskeleme dayanıklılık ölçümü (D-044 → D-046)
 *
 * D-044'te "tesseract ß'yi B okuyor, bilinen-değer maskelemesi kaçırıyor,
 * ADDRESS token 9 → 7" ölçümü YAPILDI ama TEKRAR EDİLEMEZ hâlde bırakıldı:
 * render bir Quick Look JPEG'iydi, script commit edilmedi, sayılar yalnızca
 * DECISIONS.md'de düzyazı olarak duruyor. Bu dosya o boşluğu kapatır —
 * ölçüm artık koşulabilir, ve çıktısı fixture olarak repoya yazılır.
 *
 * Akış:
 *   sentetik mektup (.txt)
 *     → Playwright/chromium ile PNG'ye render
 *     → GERÇEK tesseract.js (LocalOcrProvider — üretimdeki kod yolu)
 *     → temiz metin ve OCR metni AYNI profille maskelenir
 *     → iki bağımsız metrik raporlanır
 *
 * ── Neden bu iki metrik? ────────────────────────────────────────────────────
 * Kendi yazdığım fuzzy eşleşmeyi kendi yazdığım "bozulma simülatörü" ile
 * doğrulamak kendini onaylayan bir döngü olurdu (§8 dersi: aracı da doğrula).
 * Bu yüzden ölçüm GERÇEK tesseract çıktısı üzerinde yapılır ve iki metriğin
 * ikisi de fuzzy kurallarımdan BAĞIMSIZDIR:
 *
 *   1. Token sayısı paritesi — sadece sayar. D-044'ün kullandığı metrik.
 *   2. Levenshtein artık taraması — maskeli OCR metninde profil değerine
 *      ≥%80 benzeyen bir pencere kaldı mı? Levenshtein standart bir ölçüdür,
 *      maskeleme kurallarıma göre ayarlanmamıştır; dolayısıyla fuzzy
 *      eşleşmemin KAÇIRDIKLARINI yakalayabilir.
 *
 * ── Kullanım ────────────────────────────────────────────────────────────────
 *   npx ts-node scripts/ocr-mask-bench.ts            # ölç ve raporla
 *   npx ts-node scripts/ocr-mask-bench.ts --write    # OCR çıktısını fixture'a yaz
 *   npx ts-node scripts/ocr-mask-bench.ts --only 01  # tek mektup
 *
 * NOT (D-043): bu script `AppModule`'ü BOOT ETMEZ. `PiiService` bağımsız bir
 * sınıftır, `LocalOcrProvider`'ın da DI'ya ihtiyacı yoktur. Nest'e ihtiyaç
 * olmayan yerde Nest boot etmemek, D-043'ün doğrudan dersidir: ne kadar geniş
 * bağlam boot edilirse o kadar çok `onModuleInit` — o kadar çok dış dünya
 * yan etkisi.
 *
 * ⚠️ tesseract.js dil verisini (~15-30 MB) çalışma dizinine indirir; ilk koşu
 * yavaştır. `*.traineddata` gitignore'da.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PiiService } from '../src/common/pii/pii.service';
import { KnownPiiProfile } from '../src/common/pii/pii.types';
import { findResidue } from '../src/common/pii/ocr-residue';
import { LocalOcrProvider } from '../src/modules/llm/ocr.provider';

const FIXTURE_DIR = join(__dirname, '..', 'test-fixtures');
const LETTER_DIR = join(FIXTURE_DIR, 'behordenbriefe');
const OCR_DIR = join(FIXTURE_DIR, 'ocr');

const profiles = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'profiles.json'), 'utf8'),
) as Record<string, KnownPiiProfile>;
const expected = JSON.parse(
  readFileSync(join(LETTER_DIR, 'expected.json'), 'utf8'),
) as Record<string, { file: string }>;

// ── Render ──────────────────────────────────────────────────────────────────

/**
 * Metni bir A4 sayfası gibi render edip PNG döner.
 *
 * Gerçek bir telefon fotoğrafı değil, TEMİZ bir render — yani buradaki
 * bozulma oranı gerçek dünyanın **iyimser alt sınırı**dır (D-044 notu).
 * Eğrilik/gölge/gürültü eklenmiş bir fotoğrafta tesseract daha kötü olur.
 */
async function renderToPng(text: string): Promise<Buffer> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1240, height: 1754 }, // A4 @150dpi
      deviceScaleFactor: 2,
    });
    const html = `<body style="margin:0;background:#fff">
      <pre style="font:16px/1.6 'DejaVu Serif',Georgia,serif;color:#000;
                  margin:0;padding:48px;white-space:pre-wrap;word-break:break-word">
${escapeHtml(text)}</pre></body>`;
    await page.setContent(html, { waitUntil: 'load' });
    return await page.screenshot({ fullPage: true, type: 'png' });
  } finally {
    await browser.close();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

// ── Ölçüm ───────────────────────────────────────────────────────────────────

function tokenCounts(masked: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of masked.matchAll(/\[\[([A-Z]+)_\d+\]\]/g)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return counts;
}

function profileValues(p: KnownPiiProfile): string[] {
  return [
    p.fullName, p.familyName, p.address, p.city, p.email,
    p.phone, p.dateOfBirth, p.auslaendernummer, p.steuerId,
    p.passportNumber, p.insuranceNumber,
  ].filter((v): v is string => typeof v === 'string' && v.length > 5);
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

  const keys = Object.keys(expected)
    .filter((k) => profiles[k])
    .filter((k) => !only || k.startsWith(only));

  if (keys.length === 0) {
    console.error('Ölçülecek mektup yok (profil eşleşmedi).');
    process.exit(1);
  }

  const pii = new PiiService();
  const ocr = new LocalOcrProvider();
  if (write) mkdirSync(OCR_DIR, { recursive: true });

  console.log('═'.repeat(78));
  console.log('OCR ↔ maskeleme dayanıklılık ölçümü — GERÇEK tesseract.js');
  console.log('═'.repeat(78));

  let totalResidues = 0;
  let totalMissing = 0;

  for (const key of keys) {
    const profile = profiles[key];
    const clean = readFileSync(join(LETTER_DIR, expected[key].file), 'utf8');
    const cachePath = join(OCR_DIR, `${key}.ocr.txt`);

    // OCR pahalı (render + tanıma ≈ 10-20 sn). Fixture varsa yeniden üretme —
    // amaç zaten AYNI gerçek çıktı üzerinde tekrarlanabilir ölçüm yapmak.
    let ocrText: string;
    if (existsSync(cachePath) && !write) {
      ocrText = readFileSync(cachePath, 'utf8');
    } else {
      process.stdout.write(`\n[${key}] render + OCR… `);
      const png = await renderToPng(clean);
      ocrText = await ocr.transcribe({
        base64: png.toString('base64'),
        mediaType: 'image/png',
      });
      process.stdout.write(`${ocrText.length} karakter\n`);
      if (write) writeFileSync(cachePath, ocrText, 'utf8');
    }

    const maskedClean = pii.mask(clean, { profile });
    const maskedOcr = pii.mask(ocrText, { profile });

    const cc = tokenCounts(maskedClean.maskedText);
    const oc = tokenCounts(maskedOcr.maskedText);

    console.log(`\n── ${key} ${'─'.repeat(Math.max(0, 60 - key.length))}`);
    console.log('  tip           temiz   OCR   durum');

    const types = new Set([...cc.keys(), ...oc.keys()]);
    for (const t of [...types].sort()) {
      const a = cc.get(t) ?? 0;
      const b = oc.get(t) ?? 0;
      const status = b >= a ? '✓' : `✗ ${a - b} KAYIP`;
      if (b < a) totalMissing += a - b;
      console.log(`  ${t.padEnd(12)} ${String(a).padStart(5)} ${String(b).padStart(5)}   ${status}`);
    }

    // Bağımsız oracle
    const residues: string[] = [];
    for (const value of profileValues(profile)) {
      const hit = findResidue(maskedOcr.maskedText, value);
      if (hit) {
        residues.push(
          `${hit.value} ≈ "${hit.window.trim()}" (${(hit.score * 100).toFixed(0)}%)`,
        );
      }
    }
    totalResidues += residues.length;

    if (residues.length === 0) {
      console.log('  artık taraması: ✓ temiz (≥%80 benzeyen pencere yok)');
    } else {
      console.log(`  artık taraması: ✗ ${residues.length} SIZINTI`);
      for (const r of residues) console.log(`      ${r}`);
    }
  }

  console.log(`\n${'═'.repeat(78)}`);
  console.log(`ÖZET: ${totalMissing} kayıp token · ${totalResidues} tanınabilir artık`);
  console.log('═'.repeat(78));

  // Ölçüm aracı, ölçtüğü şey bozuksa BAŞARISIZ olmalı — sessiz "GO" vermemeli
  // (D-041 dersi).
  process.exit(totalMissing === 0 && totalResidues === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

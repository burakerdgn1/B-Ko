/**
 * ════════════════════════════════════════════════════════════════════════════
 * Doküman senkron kontrolü (D-054)
 *
 * Bu projede birden fazla kez "araç ✓ diyor ama gerçek durumu doğrulamıyor"
 * sınıfı hata yaşandı (D-033/D-039/D-041/D-050) — ama bir yakın kuzeni daha
 * var: "doküman ✓ diyor ama KOD değişti, doküman değişmedi". Bir denetimde
 * README.md hâlâ "547 test geçiyor" ve "(19 karar)" diyordu, oysa gerçek
 * sayılar çoktan 700 test ve 53 karara ulaşmıştı. Kimse yalan söylemedi —
 * sadece kimse README'yi güncellemedi. Bu script o sınıf kaymayı CI'da
 * KIRMIZI yapar: iddia (README) ile gerçek durum (DECISIONS.md, Jest) arasında
 * otomatik çapraz doğrulama.
 *
 * ── Kontrol 1: karar sayısı ──────────────────────────────────────────────
 * DECISIONS.md'deki gerçek `## D-XXX` başlık sayısını sayar ve README.md'nin
 * "Proje belgeleri" tablosundaki "(N karar)" ifadesindeki N ile karşılaştırır.
 * Bu kontrol kendi kendine yeterli — dosya okumaktan başka bağımlılığı yok.
 *
 * ── Kontrol 2: geçen test sayısı ─────────────────────────────────────────
 * README.md'deki "**N test geçiyor**" ifadesindeki N'i, gerçek Jest sonucundaki
 * `numPassedTests` ile karşılaştırır.
 *
 * Tasarım kararı — test sayısını NASIL öğreniriz:
 *   CI'daki "Birim testleri (Jest)" adımı zaten `--json --outputFile=...` ile
 *   makine-okunur bir sonuç dosyası üretiyor (bkz. ci.yml). Bu script CI'da o
 *   dosyayı OKUR — jest'i (chromium kurulumu + ~5 saniyelik koşum dahil)
 *   İKİNCİ KEZ çalıştırmak, aynı işi tekrar tekrar CI dakikası harcayarak
 *   yapmak anlamına gelirdi; mevcut çıktıyı yeniden kullanmak CI yapısına
 *   çok daha az invaziv.
 *   Yerelde (`npm run check:docs-sync`) böyle bir dosya genelde yoktur — bu
 *   durumda script, kendi kendine yeterli olsun diye jest'i KENDİSİ bir kez
 *   çalıştırıp geçici bir JSON çıktısı üretir (aşağıdaki `runJestAndCapture`).
 *   Ortam değişkeni `JEST_RESULTS_JSON` ile dosya yolu değiştirilebilir.
 *
 * Kullanım:
 *   npm run check:docs-sync                          # yerelde (jest'i kendi koşturur)
 *   JEST_RESULTS_JSON=jest-results.json npm run check:docs-sync   # CI'da (mevcut çıktıyı okur)
 * ════════════════════════════════════════════════════════════════════════════
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(__dirname, '..');

interface JestJsonResult {
  numPassedTests: number;
}

function countDecisions(): number {
  const text = readFileSync(join(ROOT, 'DECISIONS.md'), 'utf8');
  const matches = text.match(/^## D-\d+/gm) ?? [];
  return matches.length;
}

function readmeDecisionCount(): number {
  const text = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const match = /\((\d+)\s*karar\)/.exec(text);
  if (!match) {
    throw new Error(
      "README.md içinde \"(N karar)\" biçiminde bir ifade bulunamadı — " +
        "'Proje belgeleri' tablosundaki DECISIONS.md satırı değişmiş olabilir.",
    );
  }
  return Number(match[1]);
}

function readmePassedTestCount(): number {
  const text = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const match = /\*\*(\d+)\s*test geçiyor\*\*/.exec(text);
  if (!match) {
    throw new Error(
      'README.md içinde "**N test geçiyor**" biçiminde bir ifade bulunamadı.',
    );
  }
  return Number(match[1]);
}

/** CI'da üretilmiş `jest --json --outputFile=...` çıktısını okur. */
function readJestResults(path: string): JestJsonResult {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as JestJsonResult;
}

/**
 * Yerelde hazır bir sonuç dosyası yoksa jest'i biz koşturup geçici bir JSON
 * çıktısı üretiriz — script CI dışında da tek başına çalışabilsin diye.
 */
function runJestAndCapture(): JestJsonResult {
  const dir = mkdtempSync(join(tmpdir(), 'bueko-docs-sync-'));
  const outFile = join(dir, 'jest-results.json');
  try {
    console.log('ℹ️  Hazır bir Jest sonucu bulunamadı — jest yerelde koşturuluyor...');
    execFileSync(
      'npx',
      ['jest', '--json', `--outputFile=${outFile}`],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
    );
    return readJestResults(outFile);
  } catch {
    // jest başarısız test(ler) olduğunda da non-zero exit ile döner; yine de
    // sonuç dosyası genelde üretilmiş olur — okumayı dene.
    if (existsSync(outFile)) {
      return readJestResults(outFile);
    }
    throw new Error('jest koşturulamadı ve sonuç dosyası üretilmedi.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(): void {
  let problems = 0;

  console.log('═'.repeat(74));
  console.log('DOKÜMAN SENKRON KONTROLÜ (D-054)');
  console.log('═'.repeat(74));

  // ── Kontrol 1: karar sayısı ────────────────────────────────────────────
  const realDecisions = countDecisions();
  const readmeDecisions = readmeDecisionCount();
  console.log(`\nKarar sayısı  — DECISIONS.md: ${realDecisions}, README.md: ${readmeDecisions}`);
  if (realDecisions !== readmeDecisions) {
    console.log(
      `✗ UYUŞMUYOR — README.md "(${readmeDecisions} karar)" diyor, gerçek sayı ${realDecisions}. ` +
        'README.md "Proje belgeleri" tablosunu güncelleyin.',
    );
    problems++;
  } else {
    console.log('✓ eşleşiyor');
  }

  // ── Kontrol 2: geçen test sayısı ───────────────────────────────────────
  const resultsPath = process.env.JEST_RESULTS_JSON
    ? join(ROOT, process.env.JEST_RESULTS_JSON)
    : join(ROOT, 'jest-results.json');

  const jestResults = existsSync(resultsPath) ? readJestResults(resultsPath) : runJestAndCapture();
  const readmeTests = readmePassedTestCount();
  console.log(
    `\nGeçen test sayısı — Jest: ${jestResults.numPassedTests}, README.md: ${readmeTests}`,
  );
  if (jestResults.numPassedTests !== readmeTests) {
    console.log(
      `✗ UYUŞMUYOR — README.md "${readmeTests} test geçiyor" diyor, gerçek sayı ` +
        `${jestResults.numPassedTests}. README.md'yi güncelleyin.`,
    );
    problems++;
  } else {
    console.log('✓ eşleşiyor');
  }

  console.log(`\n${'═'.repeat(74)}`);
  if (problems === 0) {
    console.log('✅ Dokümanlar gerçek durumla senkron.');
  } else {
    console.log(`✗ ${problems} uyuşmazlık bulundu — yukarıya bakın.`);
  }
  console.log('═'.repeat(74));
  process.exit(problems === 0 ? 0 : 1);
}

main();

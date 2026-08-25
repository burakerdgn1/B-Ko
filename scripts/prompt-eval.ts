/**
 * Prompt değerlendirme koşumu (v1.1) — GERÇEK Claude çağrılarıyla.
 *
 * Neden gerekli: prompt "iyileştirmesi" ölçüm olmadan tahmin yürütmektir.
 * Bu script, 8 sentetik Behördenbrief'i gerçek modelden geçirir ve çıktıyı
 * `expected.json`'daki beklenen değerlerle karşılaştırarak alan bazında
 * doğruluk raporu üretir. Prompt değiştirildiğinde ÖNCE/SONRA karşılaştırması
 * yapılabilsin diye sonuçları JSON olarak da yazar.
 *
 * Kullanım:
 *   ANTHROPIC_API_KEY=sk-... npm run eval:prompts
 *   ANTHROPIC_API_KEY=sk-... npm run eval:prompts -- --out baseline.json
 *
 * ⚠️ GERÇEK API çağrısı yapar ve ÜCRETLENDİRİLİR (8 mektup × 1 çağrı).
 * ⚠️ Fixture'lar sentetiktir; gerçek kişi verisi gönderilmez (D-005).
 */
import { config as loadDotenv } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// `.env` dosyasını Nest başlamadan ÖNCE yükle: anahtar kontrolü ve
// ConfigModule'ün import-anındaki doğrulaması (D-023) buna bağlı.
loadDotenv();
import { Logger } from '@nestjs/common';
import { bootScriptContext } from './script-context';
import { LlmService } from '../src/modules/llm/llm.service';
import { PiiService } from '../src/common/pii/pii.service';
import { parseGermanDate } from '../src/modules/analysis/deadline.util';
import type { KnownPiiProfile } from '../src/common/pii/pii.types';

const FIXTURE_DIR = join(__dirname, '../test-fixtures');
const LETTER_DIR = join(FIXTURE_DIR, 'behordenbriefe');

interface ExpectedEntry {
  file: string;
  authority: string;
  requestType?: string;
  expectedDeadline?: string | null;
  expectedRiskLevel: string;
  expectedMissingDocuments?: string[];
  /** 'borderline' = rubric'i sınamak için üretilmiş zor vaka. */
  category?: string;
  /** Rubric OLMADAN naif bir okumanın vereceği tahmin (karşılaştırma için). */
  naiveExpectation?: string;
  boundary?: string;
}

interface FieldScore {
  field: string;
  correct: number;
  total: number;
}

interface CaseResult {
  key: string;
  category: string;
  boundary?: string;
  naiveExpectation?: string;
  authority: { expected: string; got: string | null; ok: boolean };
  requestType: { expected?: string; got: string | null };
  deadline: { expected: string | null; got: string | null; ok: boolean };
  riskLevel: { expected: string; got: string; ok: boolean };
  missingDocs: { expected: number; got: number; overlap: number };
  inScope: boolean;
  confidence: number;
  leaked: string[];
}

async function main(): Promise<void> {
  const logger = new Logger('PromptEval');

  if (!process.env.ANTHROPIC_API_KEY) {
    logger.error(
      'ANTHROPIC_API_KEY tanımsız — bu script GERÇEK model çağrısı gerektirir.\n' +
        '  Kullanım: ANTHROPIC_API_KEY=sk-... npm run eval:prompts\n' +
        '  Anahtar edinme: MANUAL_ACTIONS_REQUIRED.md §1',
    );
    process.exit(1);
  }

  // Mock'u kapat — gerçek çağrı yolunu zorla.
  process.env.LLM_MOCK = 'false';
  process.env.DB_DRIVER = process.env.DB_DRIVER ?? 'memory';
  process.env.TELEGRAM_MODE = 'disabled';

  const expected = JSON.parse(
    readFileSync(join(LETTER_DIR, 'expected.json'), 'utf8'),
  ) as Record<string, ExpectedEntry>;
  const profiles = JSON.parse(
    readFileSync(join(FIXTURE_DIR, 'profiles.json'), 'utf8'),
  ) as Record<string, KnownPiiProfile>;

  // D-043: kanal/scheduler yan etkisiz boot — bkz. scripts/script-context.ts.
  const app = await bootScriptContext({ logger: ['error', 'warn'] });
  const llm = app.get(LlmService);
  const pii = app.get(PiiService);

  const results: CaseResult[] = [];
  const keys = Object.keys(expected);

  for (const key of keys) {
    const entry = expected[key];
    const text = readFileSync(join(LETTER_DIR, entry.file), 'utf8');

    process.stdout.write(`\n▸ ${key} … `);

    try {
      const out = await llm.analyzeDocument({ text, profile: profiles[key] });

      // Model MASKELİ metin görür; çıktısı da token içerir (ör. kurum adındaki
      // şehir "[[ADDRESS_1]]" olarak döner). Karşılaştırmadan ÖNCE unmask et —
      // aksi hâlde model, maskeleme sözleşmesine DOĞRU uyduğu için "yanlış"
      // sayılırdı. (Bu, ilk koşumda ölçüm hatası olarak yakalandı.)
      const r = pii.unmaskDeep(out.result, out.map);

      // Deadline token'ını gerçek tarihe çöz (D-009).
      const deadlineRaw = r.deadlineToken
        ? pii.unmask(r.deadlineToken, out.map)
        : null;
      const deadline = parseGermanDate(deadlineRaw);
      const gotDeadline = deadline ? deadline.toISOString().slice(0, 10) : null;
      const wantDeadline = entry.expectedDeadline ?? null;

      // Eksik belge örtüşmesi (tam eşleşme yerine gevşek içerme).
      const wantDocs = entry.expectedMissingDocuments ?? [];
      const gotDocs = r.missingDocuments.map((d) => d.label);
      const overlap = wantDocs.filter((w) =>
        gotDocs.some(
          (g) =>
            g.toLowerCase().includes(w.toLowerCase().slice(0, 8)) ||
            w.toLowerCase().includes(g.toLowerCase().slice(0, 8)),
        ),
      ).length;

      results.push({
        key,
        category: entry.category ?? 'baseline',
        boundary: entry.boundary,
        naiveExpectation: entry.naiveExpectation,
        authority: {
          expected: entry.authority,
          got: r.authority,
          ok: !!r.authority && looselyMatches(r.authority, entry.authority),
        },
        requestType: { expected: entry.requestType, got: r.requestType },
        deadline: {
          expected: wantDeadline,
          got: gotDeadline,
          ok: gotDeadline === wantDeadline,
        },
        riskLevel: {
          expected: entry.expectedRiskLevel,
          got: r.riskLevel,
          ok: r.riskLevel === entry.expectedRiskLevel,
        },
        missingDocs: {
          expected: wantDocs.length,
          got: gotDocs.length,
          overlap,
        },
        inScope: r.inScope,
        confidence: r.confidence,
        // Gizlilik regresyonu: maskeli metinde sızıntı var mı?
        leaked: pii.detectLeaks(out.maskedText, out.map),
      });

      process.stdout.write('tamam');
    } catch (error) {
      process.stdout.write(
        `HATA: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await app.close();
  report(results);

  const outArg = process.argv.indexOf('--out');
  if (outArg !== -1 && process.argv[outArg + 1]) {
    writeFileSync(process.argv[outArg + 1], JSON.stringify(results, null, 2));
    console.log(`\nSonuçlar yazıldı: ${process.argv[outArg + 1]}`);
  }
}

function looselyMatches(got: string, want: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-zäöüß]/g, '');
  return norm(got).includes(norm(want).slice(0, 10)) ||
    norm(want).includes(norm(got).slice(0, 10));
}

function report(results: CaseResult[]): void {
  reportSubset('TÜM VAKALAR', results);

  const borderline = results.filter((r) => r.category === 'borderline');
  const baseline = results.filter((r) => r.category !== 'borderline');
  if (borderline.length > 0) {
    reportSubset('temel vakalar', baseline);
    reportSubset('SINIR VAKALAR (rubric testi)', borderline);

    console.log('\n── Sınır vakalarda riskLevel detayı ──');
    console.log(
      '  ' +
        'vaka'.padEnd(38) +
        'sınır'.padEnd(18) +
        'naif'.padEnd(10) +
        'model'.padEnd(10) +
        'doğru',
    );
    for (const r of borderline) {
      const mark = r.riskLevel.ok ? '✓' : '✗';
      const naiveTrap = r.riskLevel.got === r.naiveExpectation ? ' ⚠naif' : '';
      console.log(
        `  ${mark} ${r.key.padEnd(36)}${(r.boundary ?? '').padEnd(18)}` +
          `${(r.naiveExpectation ?? '').padEnd(10)}${String(r.riskLevel.got).padEnd(10)}` +
          `${r.riskLevel.expected}${naiveTrap}`,
      );
    }
  }
}

function reportSubset(title: string, results: CaseResult[]): void {
  if (results.length === 0) return;
  const total = results.length;
  const scores: FieldScore[] = [
    { field: 'authority', correct: results.filter((r) => r.authority.ok).length, total },
    { field: 'deadline', correct: results.filter((r) => r.deadline.ok).length, total },
    { field: 'riskLevel', correct: results.filter((r) => r.riskLevel.ok).length, total },
  ];

  console.log(`\n── ${title} (n=${total}) ──`);

  for (const s of scores) {
    const pct = total > 0 ? Math.round((s.correct / total) * 100) : 0;
    console.log(`  ${s.field.padEnd(12)} ${s.correct}/${s.total}  (%${pct})`);
  }

  const docsRecall = results.reduce(
    (acc, r) => acc + (r.missingDocs.expected > 0 ? r.missingDocs.overlap / r.missingDocs.expected : 1),
    0,
  );
  console.log(
    `  ${'missingDocs'.padEnd(12)} ortalama recall: %${Math.round((docsRecall / Math.max(results.length, 1)) * 100)}`,
  );

  const leaks = results.filter((r) => r.leaked.length > 0);
  console.log(
    `\n  🔒 PII sızıntısı: ${leaks.length === 0 ? 'YOK ✅' : `${leaks.length} vakada VAR ❌`}`,
  );

}

void main();

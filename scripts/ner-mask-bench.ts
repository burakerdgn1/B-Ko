/**
 * ════════════════════════════════════════════════════════════════════════════
 * Yerel NER ↔ üçüncü taraf isim maskeleme ölçümü (D-028'in v2 tasarımı için)
 *
 * D-028'de bilinçli olarak açık bırakılan sınır: tetikleyici bağlamı olmadan
 * geçen üçüncü taraf isimleri ("Der Antrag wurde von Sabine Brandt geprüft")
 * mevcut deterministik motorla YAKALANAMAZ (bkz. pii.gap-audit.spec.ts —
 * "🟡 KALAN SINIR"). Bu script, o boşluğu yerel bir NER modeliyle kapatmanın
 * GERÇEKTEN işe yarayıp yaramadığını — production koduna hiç dokunmadan —
 * ölçer.
 *
 * ── Neden bu script var, "biliyoruz zaten çalışır" yerine ────────────────────
 * D-044'ün dersi: bir aracın doğruluğu hakkındaki iddia, ölçülüp
 * TEKRARLANABİLİR hâle getirilmeden "biliyoruz" sayılmaz. NER modelleri
 * (burada Davlan/bert-base-multilingual-cased-ner-hrl'nin ONNX'e çevrilmiş
 * hâli) Almanca CoNLL-2003 HABER metniyle eğitilmiş — Behördenbrief kaydı
 * tamamen farklı bir alan. Bu script çalışmadan "NER işe yarar" demek, yarım
 * bir modeli "çözüldü" ilan etmek olurdu (D-028'in tam eleştirdiği şey).
 *
 * ── Ölçülen ────────────────────────────────────────────────────────────────
 *   1. RECALL (bare-name)     — tetikleyicisiz isimlerin kaçı yakalanıyor?
 *                                (asıl hedef — bu sıfırsa NER'in anlamı yok)
 *   2. FALSE-POSITIVE (trap)  — kurum adı/büyük harfli terim yanlışlıkla
 *                                İSİM sayılıyor mu? (mevcut motorun D-029'da
 *                                özenle önlediği şey — NER bunu geri getirmemeli)
 *   3. RECALL (trigger/çokkültürlü) — mevcut motorun zaten yakaladığı
 *                                isimleri NER de buluyor mu? (tutarlılık)
 *   4. Gecikme                — model başına, örnek başına ms
 *
 * ── Bu script PRODUCTION KODUNA DOKUNMAZ ─────────────────────────────────────
 * `PiiService`den bağımsız çalışır; hiçbir pipeline/servise bağlanmaz. Amaç
 * yalnızca "bu yöne yatırım yapmaya değer mi?" sorusuna rakamla cevap vermek.
 * Kabul kriteri (örnek): bare-name recall ≥ %70 VE trap false-positive = 0
 * karşılanmadan `NER_ENABLED` gibi bir bayrak asla production'a alınmamalı.
 *
 * ── Kullanım ──────────────────────────────────────────────────────────────
 *   npm run bench:ner-mask                    # varsayılan model
 *   npm run bench:ner-mask -- --model=base    # tam BERT-base (daha büyük/yavaş)
 *   npm run bench:ner-mask -- --model=both    # ikisini karşılaştır
 *
 * ⚠️ İlk koşuda model Hugging Face Hub'dan indirilir (distil ~135MB, base
 * ~178MB, quantized/int8) ve yerel önbelleğe (`.cache/`, gitignore'da) yazılır
 * — tıpkı tesseract.js'in dil verisini indirmesi gibi (bkz. ocr-mask-bench.ts).
 * Bu script `AppModule`'ü BOOT ETMEZ (D-043 dersi).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { PiiService } from '../src/common/pii/pii.service';
import { PiiEntityType } from '../src/common/pii/pii.types';

type Category =
  | 'trigger-context'
  | 'bare-name'
  | 'multicultural-bare'
  | 'false-positive-trap';

interface BenchCase {
  id: string;
  category: Category;
  text: string;
  /** Model'in PER olarak bulmasını BEKLEDİĞİMİZ tam isim span'leri. Trap için boş. */
  expectedPersons: string[];
}

// ── Etiketli korpus ───────────────────────────────────────────────────────
//
// trigger-context / false-positive-trap: pii.gap-audit.spec.ts'teki mevcut,
// zaten denetlenmiş örneklerin BİREBİR aynısı — iki ayrı ölçümün aynı zemin
// üzerinde konuşması için (kendi kurduğum yeni bir kritere göre değil).
// bare-name / multicultural-bare: BU script için yazıldı; hepsi kurgusal
// (bkz. DECISIONS.md D-005 sentetik fixture ilkesi), gerçek kişiyle ilgisi yok.
const CORPUS: BenchCase[] = [
  // ── 🎯 asıl hedef: tetikleyicisiz üçüncü taraf isimleri ──────────────────
  {
    id: 'bare-01',
    category: 'bare-name',
    text: 'Der Antrag wurde von Sabine Brandt geprüft und weitergeleitet.',
    expectedPersons: ['Sabine Brandt'],
  },
  {
    id: 'bare-02',
    category: 'bare-name',
    text: 'Nach Rücksprache mit Michael Wagner wurde die Frist verlängert.',
    expectedPersons: ['Michael Wagner'],
  },
  {
    id: 'bare-03',
    category: 'bare-name',
    text: 'Thomas Fischer hat die Akte am 12.05.2024 bearbeitet.',
    expectedPersons: ['Thomas Fischer'],
  },
  {
    id: 'bare-04',
    category: 'bare-name',
    text: 'Bitte wenden Sie sich bei Rückfragen an Julia Hoffmann.',
    expectedPersons: ['Julia Hoffmann'],
  },
  {
    id: 'bare-05',
    category: 'bare-name',
    text: 'Laut Auskunft von Peter Klein liegt der Vorgang derzeit zur Prüfung vor.',
    expectedPersons: ['Peter Klein'],
  },
  {
    id: 'bare-06',
    category: 'bare-name',
    text: 'Die Unterschrift von Anna Schulz bestätigt den Eingang der Unterlagen.',
    expectedPersons: ['Anna Schulz'],
  },
  {
    id: 'bare-07',
    category: 'bare-name',
    text: 'Ihr Nachbar Klaus Berger hat eine Stellungnahme abgegeben.',
    expectedPersons: ['Klaus Berger'],
  },

  // ── çokkültürlü isimler, TETİKLEYİCİSİZ ──────────────────────────────────
  {
    id: 'multi-bare-01',
    category: 'multicultural-bare',
    text: 'Der Fall wurde von Fatma Yıldız bearbeitet.',
    expectedPersons: ['Fatma Yıldız'],
  },
  {
    id: 'multi-bare-02',
    category: 'multicultural-bare',
    text: 'Nach Angaben von Nguyễn Văn An liegt derzeit keine Frist vor.',
    expectedPersons: ['Nguyễn Văn An'],
  },
  {
    id: 'multi-bare-03',
    category: 'multicultural-bare',
    text: 'Laut Mohammed Al-Rashid ist die Zahlung bereits erfolgt.',
    expectedPersons: ['Mohammed Al-Rashid'],
  },
  {
    id: 'multi-bare-04',
    category: 'multicultural-bare',
    text: 'Die Akte wurde durch Oleksandra Kovalenko weitergeleitet.',
    expectedPersons: ['Oleksandra Kovalenko'],
  },

  // ── tutarlılık: mevcut motorun ZATEN yakaladığı tetikleyici bağlamlar ────
  // (pii.gap-audit.spec.ts "🟢 İSİMLER" ile birebir aynı metinler)
  {
    id: 'trigger-01',
    category: 'trigger-context',
    text: 'Sehr geehrter Herr Ahmet Yılmaz,',
    expectedPersons: ['Ahmet Yılmaz'],
  },
  {
    id: 'trigger-02',
    category: 'trigger-context',
    text: 'Ihre Sachbearbeiterin: Frau Sabine Brandt',
    expectedPersons: ['Sabine Brandt'],
  },
  {
    id: 'trigger-03',
    category: 'trigger-context',
    text: 'Herrn Yasin Kılıç',
    expectedPersons: ['Yasin Kılıç'],
  },
  {
    id: 'trigger-04',
    category: 'trigger-context',
    text: 'für Ihre Ehefrau Elif Demir',
    expectedPersons: ['Elif Demir'],
  },
  {
    id: 'trigger-05',
    category: 'trigger-context',
    text: 'Rechtsanwältin Claudia Weber',
    expectedPersons: ['Claudia Weber'],
  },
  {
    id: 'trigger-06',
    category: 'trigger-context',
    text: 'Sehr geehrte Frau Nguyễn Thị Hồng,',
    expectedPersons: ['Nguyễn Thị Hồng'],
  },

  // ── 🛡️ yanlış-pozitif tuzakları (pii.gap-audit.spec.ts ile birebir aynı) ──
  {
    id: 'trap-01',
    category: 'false-positive-trap',
    text: 'Sehr geehrte Damen und Herren,',
    expectedPersons: [],
  },
  {
    id: 'trap-02',
    category: 'false-positive-trap',
    text: 'Ausländerbehörde Berlin',
    expectedPersons: [],
  },
  {
    id: 'trap-03',
    category: 'false-positive-trap',
    text: 'Bitte reichen Sie die Unterlagen fristgerecht ein.',
    expectedPersons: [],
  },
  {
    id: 'trap-04',
    category: 'false-positive-trap',
    text: 'Betreff: Antrag auf Verlängerung der Aufenthaltserlaubnis',
    expectedPersons: [],
  },
  {
    id: 'trap-05',
    category: 'false-positive-trap',
    text: 'Aktueller Mietvertrag und Nachweis über Krankenversicherung',
    expectedPersons: [],
  },
  {
    id: 'trap-06',
    category: 'false-positive-trap',
    text: 'Mit freundlichen Grüßen',
    expectedPersons: [],
  },
  {
    id: 'trap-07',
    category: 'false-positive-trap',
    text: 'Bundesamt für Migration und Flüchtlinge',
    expectedPersons: [],
  },
  {
    id: 'trap-08',
    category: 'false-positive-trap',
    text: 'Regionaldirektion Berlin-Brandenburg der Bundesagentur für Arbeit',
    expectedPersons: [],
  },
  {
    id: 'trap-09',
    category: 'false-positive-trap',
    text: 'Bitte legen Sie gegen diesen Bescheid innerhalb eines Monats Widerspruch ein.',
    expectedPersons: [],
  },
];

const MODELS = {
  distil: 'Xenova/distilbert-base-multilingual-cased-ner-hrl',
  base: 'Xenova/bert-base-multilingual-cased-ner-hrl',
} as const;

interface NerEntity {
  entity_group?: string;
  entity?: string;
  word: string;
  score: number;
  start?: number;
  end?: number;
}

interface CaseResult {
  case: BenchCase;
  detected: string[];
  matchedExpected: string[];
  missedExpected: string[];
  spurious: string[];
  ms: number;
}

/** Model çıktısındaki isim span'i, beklenen span'i İÇERİYORSA (veya tersi) eşleşme sayılır. */
/**
 * Bu sürümdeki `aggregation_strategy: 'simple'`, karakter ofseti (`start`/
 * `end`) döndürmüyor — yalnızca WordPiece'ten yeniden birleştirilmiş `word`.
 * Bu birleştirme, tire/kesme işareti gibi noktalama etrafına gerçek metinde
 * OLMAYAN boşluklar ekleyebilir ("Mohammed Al-Rashid" → "Mohammed Al - Rashid").
 * Bu yüzden karşılaştırma TÜM boşlukları yok sayar — kısa isim span'leri için
 * yanlış eşleşme riski ihmal edilebilir düzeyde.
 */
function overlaps(a: string, b: string): boolean {
  const na = a.trim().toLowerCase().replace(/\s+/g, '');
  const nb = b.trim().toLowerCase().replace(/\s+/g, '');
  return na.length > 0 && nb.length > 0 && (na.includes(nb) || nb.includes(na));
}

async function runModel(modelId: string): Promise<CaseResult[]> {
  // Dinamik import: @huggingface/transformers optionalDependency — kurulu
  // değilse bu script anlamlı bir hatayla çıkmalı, tüm proje ÇÖKMEMELİ.
  const { pipeline } = await import('@huggingface/transformers');

  process.stdout.write(`\n  model indiriliyor/yükleniyor: ${modelId} … `);
  const t0 = Date.now();
  const classifier = await pipeline('token-classification', modelId);
  process.stdout.write(`${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const results: CaseResult[] = [];
  for (const c of CORPUS) {
    const start = Date.now();
    const raw = (await classifier(c.text, {
      aggregation_strategy: 'simple',
    })) as unknown as NerEntity[];
    const ms = Date.now() - start;

    // Yeniden birleştirilmiş `word` alanı yerine ORİJİNAL metinden start/end
    // ile dilim alınır — aksi hâlde WordPiece detokenizasyonu tire/kesme
    // işareti gibi noktalama etrafına yanlışlıkla boşluk ekleyebilir
    // ("Mohammed Al-Rashid" → "Mohammed Al - Rashid"), bu da modelin DOĞRU
    // bulduğu bir varlığı sahte bir "kaçırıldı" gibi göstermeye yol açar.
    const detected = raw
      .filter((e) => (e.entity_group ?? e.entity) === 'PER')
      .map((e) =>
        typeof e.start === 'number' && typeof e.end === 'number'
          ? c.text.slice(e.start, e.end).trim()
          : e.word.trim(),
      )
      .filter((w) => w.length > 1);

    const matchedExpected: string[] = [];
    const missedExpected: string[] = [];
    for (const exp of c.expectedPersons) {
      if (detected.some((d) => overlaps(d, exp))) matchedExpected.push(exp);
      else missedExpected.push(exp);
    }
    const spurious = detected.filter(
      (d) => !c.expectedPersons.some((exp) => overlaps(d, exp)),
    );

    results.push({ case: c, detected, matchedExpected, missedExpected, spurious, ms });
  }
  return results;
}

function summarize(modelId: string, results: CaseResult[]): boolean {
  console.log(`\n${'─'.repeat(78)}`);
  console.log(`Model: ${modelId}`);
  console.log('─'.repeat(78));

  let overallOk = true;

  for (const cat of [
    'bare-name',
    'multicultural-bare',
    'trigger-context',
    'false-positive-trap',
  ] as Category[]) {
    const inCat = results.filter((r) => r.case.category === cat);
    if (inCat.length === 0) continue;

    if (cat === 'false-positive-trap') {
      const withSpurious = inCat.filter((r) => r.spurious.length > 0);
      console.log(
        `\n  🛡️  ${cat}: ${inCat.length - withSpurious.length}/${inCat.length} temiz (yanlış-pozitif YOK)`,
      );
      for (const r of withSpurious) {
        overallOk = false;
        console.log(`      ✗ [${r.case.id}] "${r.case.text}"`);
        console.log(`         yanlışlıkla İSİM sayıldı: ${r.spurious.join(', ')}`);
      }
    } else {
      const totalExpected = inCat.reduce((s, r) => s + r.case.expectedPersons.length, 0);
      const totalMatched = inCat.reduce((s, r) => s + r.matchedExpected.length, 0);
      const recall = totalExpected > 0 ? (totalMatched / totalExpected) * 100 : 100;
      const label =
        cat === 'bare-name'
          ? '🎯 bare-name (asıl hedef)'
          : cat === 'multicultural-bare'
            ? '🌍 multicultural-bare'
            : '🟢 trigger-context (tutarlılık)';
      console.log(
        `\n  ${label}: recall %${recall.toFixed(0)} (${totalMatched}/${totalExpected})`,
      );
      for (const r of inCat) {
        if (r.missedExpected.length > 0) {
          console.log(`      ✗ [${r.case.id}] kaçırıldı: ${r.missedExpected.join(', ')} — "${r.case.text}"`);
        }
      }
      if (cat === 'bare-name' && recall < 70) overallOk = false;
    }
  }

  const avgMs = results.reduce((s, r) => s + r.ms, 0) / results.length;
  console.log(`\n  ⏱  ortalama gecikme: ${avgMs.toFixed(0)}ms / örnek (${results.length} örnek)`);

  console.log(
    `\n  ${overallOk ? '✅ KABUL EŞİĞİ GEÇİLDİ' : '✗ KABUL EŞİĞİ GEÇİLEMEDİ'} ` +
      '(kriter: bare-name recall ≥ %70 VE trap kategorisinde sıfır yanlış-pozitif)',
  );
  return overallOk;
}

async function main(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith('--model='));
  const which = (arg?.split('=')[1] ?? 'distil') as 'distil' | 'base' | 'both';

  const modelIds =
    which === 'both' ? [MODELS.distil, MODELS.base] : [MODELS[which] ?? MODELS.distil];

  console.log('═'.repeat(78));
  console.log('Yerel NER ↔ üçüncü taraf isim maskeleme ölçümü (D-028 v2 tasarımı)');
  console.log(`Korpus: ${CORPUS.length} örnek — bare-name, multicultural-bare, trigger-context, trap`);
  console.log('═'.repeat(78));

  // Mevcut deterministik motorla çapraz-doğrulama: trigger-context ve trap
  // kategorilerinin GERÇEKTEN pii.gap-audit.spec.ts ile aynı davranışı
  // ürettiğini kendi PiiService'imizle de teyit ederiz — korpus yanlışlıkla
  // gap-audit'ten sapmışsa burada patlar.
  const pii = new PiiService();
  let driftFound = false;
  for (const c of CORPUS) {
    if (c.category !== 'trigger-context' && c.category !== 'false-positive-trap') continue;
    const { map } = pii.mask(c.text);
    const foundName = map.matches.some((m) => m.type === PiiEntityType.NAME);
    const shouldFind = c.category === 'trigger-context';
    if (foundName !== shouldFind) {
      driftFound = true;
      console.log(
        `⚠️  KORPUS SAPMASI [${c.id}]: mevcut PiiService ${foundName ? 'YAKALADI' : 'YAKALAMADI'}, ` +
          `beklenen ${shouldFind ? 'YAKALAMASIYDI' : 'YAKALAMAMASIYDI'} — "${c.text}"`,
      );
    }
  }
  if (!driftFound) {
    console.log('\n✓ Korpusun trigger-context/trap kısmı mevcut PiiService ile tutarlı.');
  }

  let allOk = true;
  for (const modelId of modelIds) {
    try {
      const results = await runModel(modelId);
      const ok = summarize(modelId, results);
      allOk = allOk && ok;
    } catch (err) {
      allOk = false;
      console.error(`\n✗ ${modelId} çalıştırılamadı: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${'═'.repeat(78)}`);
  console.log(
    allOk
      ? '✅ SONUÇ: en az bir model kabul eşiğini geçti — v2 tasarımı ilerletilebilir.'
      : "✗ SONUÇ: hiçbir model kabul eşiğini geçemedi — NER_ENABLED production'da AÇILMAMALI.",
  );
  console.log('═'.repeat(78));

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

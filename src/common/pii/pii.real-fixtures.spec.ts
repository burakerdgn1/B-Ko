import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PiiService } from './pii.service';
import { findResidue } from './ocr-residue';
import { KnownPiiProfile, PiiEntityType } from './pii.types';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * GERÇEK (anonimleştirilmiş) Behördenbrief doğrulaması (D-048)
 *
 * Bugüne kadarki tüm doğrulama sentetikti (D-005). Sentetik metin gerçek
 * tarama gürültüsünü, gerçek Beamtendeutsch varyasyonunu ve beklenmedik belge
 * yapılarını temsil etmiyor — D-046'da tam da bu yüzden yıllardır duran bir
 * desen boşluğu (`Karl-Marx-Allee`) ancak yeni bir bakış açısıyla görülebildi.
 *
 * Bu suite `test-fixtures/real/` altındaki dosyaları OTOMATİK bulur ve
 * sentetiklerle AYNI invaryantları uygular. Dosya bırakmak yeterlidir.
 *
 * Gizlilik: o dizin `.gitignore`'dadır (README ve `*.example.json` hariç).
 * Kurulum ve anonimleştirme kontrolü: `test-fixtures/real/README.md`.
 * ════════════════════════════════════════════════════════════════════════════
 */

const REAL_DIR = join(__dirname, '../../../test-fixtures/real');
const EXPECTED_PATH = join(REAL_DIR, 'expected.json');
const PROFILES_PATH = join(REAL_DIR, 'profiles.json');

interface RealEntry {
  file: string;
  authority?: string | null;
  expectedRiskLevel?: string | null;
  expectedDeadline?: string | null;
  expectedPiiTypes?: string[];
}

function loadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (err) {
    throw new Error(
      `${path} okunamadı (geçersiz JSON?): ${err instanceof Error ? err.message : err}`,
      { cause: err },
    );
  }
}

/**
 * `expected.json` iki farklı şekilde yazılmış bulunabiliyor (D-051):
 *
 *  1. Bu dizinin dokümante ettiği (README.md, expected.example.json) minimal
 *     şema — `test-fixtures/behordenbriefe/expected.json` ile aynı:
 *     `{ "<kısa-ad>": { file, expectedRiskLevel, expectedDeadline, expectedPiiTypes } }`.
 *
 *  2. Anahtarın kendisini zaten dosya adı olarak kullanan, ayrı bir `.file`
 *     alanı taşımayan daha zengin, alternatif alan adlarına sahip bir şema
 *     (`riskLevel`, `deadline`, `piiMustBeMasked: { TYPE: [ham değerler] }`, ...).
 *
 * D-051'de tam olarak ikinci şekille yazılmış bir `expected.json` bu
 * makinede bulundu; spec kayıtsız şartsız `expected[k].file` okuyunca
 * `undefined` çıktı ve `join()` anlaşılmaz bir `TypeError` ile çöktü.
 *
 * Bilinçli sınır: `expectedPiiTypes`'ı `piiMustBeMasked`'ın anahtarlarından
 * OTOMATİK türetmiyoruz. Türetseydik, bu fixture'lardaki STEUERID/IBAN/PHONE
 * gibi tiplerin maskeleme motoru tarafından yakalanıp yakalanmadığını da
 * iddialı biçimde test etmiş olurduk — ki bu ayrı, doğrulanmamış bir üretim
 * davranışı iddiasıdır ve bu görevin (test altyapısını onarmak) kapsamı
 * dışındadır; ayrı bir görev/karar olarak ele alınmalı. Bu yüzden yalnızca
 * dosya kimliğini (file) normalize ediyoruz; `expectedPiiTypes` yalnızca
 * kanonik alan adıyla verilmişse okunur, yoksa (bu suitenin zaten desteklediği
 * "opsiyonel alan" tasarımıyla tutarlı biçimde) o tek assertion atlanır —
 * geri kalan 7 gerçek-fixture invaryantı (round-trip, sızıntı, kalıntı,
 * içerik korunumu, aşırı-maskeleme sınırı) her koşulda çalışır.
 *
 * Nesne olmayan bir değerse (ör. biri anahtarın karşılığını string/array
 * yapmışsa) sessizce atlamak yerine hangi anahtarda ne bulunduğunu söyleyen
 * açık bir hata fırlatılır: bu projede "araç ✓ diyor ama doğrulamıyor" sınıfı
 * (D-045, D-046) defalarca ısırdığı için burada da aynı sessiz-atlama
 * riskine izin verilmiyor.
 */
function normalizeEntry(key: string, raw: unknown): RealEntry {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `test-fixtures/real/expected.json["${key}"] bir nesne olmalı, ` +
        `${Array.isArray(raw) ? 'array' : typeof raw} bulundu. Şema için ` +
        `test-fixtures/real/README.md ve expected.example.json'a bakın.`,
    );
  }
  const entry = raw as Record<string, unknown>;
  const file =
    typeof entry.file === 'string'
      ? entry.file
      : key.endsWith('.txt')
        ? key
        : `${key}.txt`;

  return {
    file,
    authority: (entry.authority as string | null | undefined) ?? null,
    expectedRiskLevel: (entry.expectedRiskLevel as string | null | undefined) ?? null,
    expectedDeadline: (entry.expectedDeadline as string | null | undefined) ?? null,
    expectedPiiTypes: Array.isArray(entry.expectedPiiTypes)
      ? (entry.expectedPiiTypes as string[])
      : undefined,
  };
}

const rawExpected = loadJson<Record<string, unknown>>(EXPECTED_PATH) ?? {};
// Alt çizgiyle başlayan anahtarlar açıklama içindir (bkz. expected.example.json).
const expected: Record<string, RealEntry> = Object.fromEntries(
  Object.keys(rawExpected)
    .filter((k) => !k.startsWith('_'))
    .map((k) => [k, normalizeEntry(k, rawExpected[k])]),
);
const profiles = loadJson<Record<string, KnownPiiProfile>>(PROFILES_PATH) ?? {};

const keys = Object.keys(expected).filter((k) =>
  existsSync(join(REAL_DIR, expected[k].file)),
);

/**
 * `REQUIRE_REAL_FIXTURES=1` → fixture yoksa SKIP değil FAIL.
 * D-045 ile aynı mantık: sessiz atlama, bu projede dört kez ısıran
 * "araç ✓ diyor ama doğrulamıyor" sınıfıdır.
 */
const required = ['1', 'true'].includes(
  (process.env.REQUIRE_REAL_FIXTURES ?? '').trim().toLowerCase(),
);

if (keys.length === 0) {
  const stray = existsSync(REAL_DIR)
    ? readdirSync(REAL_DIR).filter((f) => f.endsWith('.txt'))
    : [];

  describe('Gerçek Behördenbrief fixture\'ları', () => {
    // Sessiz atlamıyoruz: durum HER ZAMAN görünür bir test olarak raporlanır.
    it(required ? 'fixture bulunmalı (REQUIRE_REAL_FIXTURES=1)' : 'henüz eklenmedi — atlanıyor', () => {
      if (required) {
        throw new Error(
          'REQUIRE_REAL_FIXTURES=1 ayarlı ama test-fixtures/real/ altında ' +
            'kullanılabilir fixture yok. Kurulum: test-fixtures/real/README.md',
        );
      }
      if (stray.length > 0) {
        // Sık yapılan hata: .txt konmuş ama expected.json'a girilmemiş.
        // Bu sessizce "fixture yok" gibi görünürdü.
        throw new Error(
          `test-fixtures/real/ altında ${stray.length} adet .txt var ama expected.json'da ` +
            `karşılığı yok: ${stray.join(', ')}. README'deki 2. adımı tamamlayın.`,
        );
      }
      expect(keys).toEqual([]);
    });
  });
}

// Jest `.each` BOŞ dizide "called with an empty Array" hatası fırlatır ve
// suite "failed to run" olur — yani fixture yokken hiçbir şey koşmaz ve
// yukarıdaki bilgilendirici testler de kaybolurdu. Bu yüzden koşullu.
const describeEachKey = keys.length > 0 ? describe.each(keys) : () => {};

describeEachKey('Gerçek Behördenbrief — %s', (key: string) => {
  const entry = expected[key];
  const read = () => readFileSync(join(REAL_DIR, entry.file), 'utf8');
  const profile = (): KnownPiiProfile | undefined => profiles[key];

  let pii: PiiService;
  beforeEach(() => {
    pii = new PiiService();
  });

  it('okunabilir ve anlamlı uzunlukta', () => {
    expect(read().trim().length).toBeGreaterThan(100);
  });

  it('round-trip kayıpsız: unmask(mask(x)) === x', () => {
    const text = read();
    const { maskedText, map } = pii.mask(text, { profile: profile() });
    expect(pii.unmask(maskedText, map)).toBe(text);
  });

  it('maskeli metinde ham PII kalmaz (LLM\'e gitmeye güvenli)', () => {
    const { maskedText, map } = pii.mask(read(), { profile: profile() });
    expect(pii.detectLeaks(maskedText, map)).toEqual([]);
  });

  it('profil değerleri maskeli metinde GEÇMEZ', () => {
    const p = profile();
    if (!p) return; // profil isteğe bağlı
    const { maskedText } = pii.mask(read(), { profile: p });

    const leaked = Object.values(p)
      .filter((v): v is string => typeof v === 'string' && v.length > 3)
      .filter((v) => maskedText.includes(v));

    expect(leaked).toEqual([]);
  });

  it('profil değerlerine benzeyen KALINTI yok (bulanık tarama, D-046)', () => {
    const p = profile();
    if (!p) return;
    const { maskedText } = pii.mask(read(), { profile: p });

    // Gerçek metinde tarama/OCR bozulmaları beklenir; tam eşleşme yetmez.
    const hits = Object.values(p)
      .filter((v): v is string => typeof v === 'string' && v.length > 5)
      .map((v) => findResidue(maskedText, v))
      .filter((h): h is NonNullable<typeof h> => h !== null)
      .map((h) => `${h.value} ≈ "${h.window.trim()}" (${Math.round(h.score * 100)}%)`);

    expect(hits).toEqual([]);
  });

  it('beklenen PII tipleri yakalanır', () => {
    if (!entry.expectedPiiTypes?.length) return;
    const { map } = pii.mask(read(), { profile: profile() });
    const found = new Set(map.matches.map((m) => m.type));

    const missing = entry.expectedPiiTypes.filter(
      (t) => !found.has(t as PiiEntityType),
    );
    expect(missing).toEqual([]);
  });

  /**
   * Aşırı maskelemenin ASIL ölçüsü orandan çok içeriktir: modelin belgeyi
   * sınıflandırabilmesi için kurum türü, konu satırı ve talep metni ayakta
   * kalmalıdır. Oran yalnızca kaba bir emniyet kemeridir.
   */
  it('belgenin analiz edilebilirliği korunur (kurum/konu/kapanış)', () => {
    const { maskedText } = pii.mask(read(), { profile: profile() });
    expect(maskedText).toMatch(
      /Ausländerbehörde|Bürgeramt|Landeshauptstadt|Amt|Behörde|Finanzamt|Jobcenter/i,
    );
    expect(maskedText).toMatch(/Betreff|Sehr geehrte|Mit freundlichen Grüßen/i);
  });

  it('aşırı maskeleme yok (uzunluğa duyarlı sınır)', () => {
    const { maskedText } = pii.mask(read(), { profile: profile() });
    const tokens = (maskedText.match(/\[\[[A-Z]+_\d+\]\]/g) ?? []).length;
    const words = maskedText.split(/\s+/).filter(Boolean).length;

    // Adres blokları SABİT maliyettir (gönderen + alıcı ≈ 10 token), mektup
    // uzunluğundan bağımsız. Bu yüzden tek bir oran eşiği uzunluğa duyarlıdır:
    // sentetik fixture'lar ~200 kelime ve %9-11'de kalırken, gövdesi kısa ama
    // başlığı tam bir mektup yapısal olarak %25'e çıkabilir — maskeleme yanlış
    // olmadan. Ölçüldü (D-048): 59 kelimelik gerçekçi bir mektupta %25,4 ve
    // maskeli metin tamamen analiz edilebilir durumdaydı.
    const limit = words >= 150 ? 0.15 : 0.32;
    const ratio = tokens / words;

    // Kırıldığında hangi mektubun hangi oranla düştüğü çıktıdan okunabilsin.
    expect({ kelime: words, oran: Number(ratio.toFixed(3)), sınır: limit }).toEqual({
      kelime: words,
      oran: ratio < limit ? Number(ratio.toFixed(3)) : `AŞILDI: ${ratio.toFixed(3)}`,
      sınır: limit,
    });
  });
});

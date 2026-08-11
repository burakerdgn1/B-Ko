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
    );
  }
}

const expected = loadJson<Record<string, RealEntry>>(EXPECTED_PATH) ?? {};
const profiles = loadJson<Record<string, KnownPiiProfile>>(PROFILES_PATH) ?? {};

// Alt çizgiyle başlayan anahtarlar açıklama içindir (bkz. expected.example.json).
const keys = Object.keys(expected)
  .filter((k) => !k.startsWith('_'))
  .filter((k) => existsSync(join(REAL_DIR, expected[k].file)));

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

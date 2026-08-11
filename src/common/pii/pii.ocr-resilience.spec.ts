import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PiiService } from './pii.service';
import { findResidue, similarity, RESIDUE_THRESHOLD } from './ocr-residue';
import { KnownPiiProfile } from './pii.types';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * OCR dayanıklılığı — D-044'ün bulgusunun KALICI regresyon koruması (D-046)
 *
 * D-044 gerçek bir gizlilik regresyonu ölçtü (`Torstraße 15` → `TorstraBe 15`,
 * kullanıcının kendi adresi maskelenmeden LLM'e gidiyor) ama ölçümü TEKRAR
 * EDİLEMEZ bıraktı: render tek seferlikti, script commit edilmedi, sayılar
 * yalnızca düzyazı olarak kaldı. Bu dosya o boşluğu kapatır.
 *
 * Girdi, elle uydurulmuş "bozuk metin" DEĞİL: `test-fixtures/ocr/` altındaki
 * dosyalar GERÇEK tesseract.js çıktısıdır (`scripts/ocr-mask-bench.ts --write`
 * ile üretilir; render → OCR ≈ 15 sn/mektup). Testte yeniden üretilmezler —
 * amaç aynı gerçek çıktı üzerinde ucuz ve tekrarlanabilir doğrulama.
 *
 * Kendi bozulma simülatörümü kendi fuzzy eşleştiricimle doğrulamak kendini
 * onaylayan bir döngü olurdu; bu projede aracın kendisinin yanıldığı dört
 * vaka var (D-033, D-039, D-041 + teşhis script'i). Bu yüzden hem girdi hem
 * de ikinci metrik dışarıdan gelir.
 * ════════════════════════════════════════════════════════════════════════════
 */

const FIXTURE_DIR = join(__dirname, '../../../test-fixtures');
const LETTER_DIR = join(FIXTURE_DIR, 'behordenbriefe');
const OCR_DIR = join(FIXTURE_DIR, 'ocr');

const expected: Record<string, { file: string }> = JSON.parse(
  readFileSync(join(LETTER_DIR, 'expected.json'), 'utf8'),
);
const profiles: Record<string, KnownPiiProfile> = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'profiles.json'), 'utf8'),
);

const keys = Object.keys(expected).filter(
  (k) => profiles[k] && existsSync(join(OCR_DIR, `${k}.ocr.txt`)),
);

const readClean = (k: string) => readFileSync(join(LETTER_DIR, expected[k].file), 'utf8');
const readOcr = (k: string) => readFileSync(join(OCR_DIR, `${k}.ocr.txt`), 'utf8');

/**
 * `findResidue`'nun ön elemesiz, kaba kuvvet referans implementasyonu.
 * Yalnızca optimizasyonun sonucu değiştirmediğini kanıtlamak için var.
 */
function bruteForceResidue(masked: string, value: string): string | null {
  const hay = masked.replace(/\[\[[A-Z]+_\d+\]\]/g, ' ').toLowerCase();
  const needle = value.toLowerCase();
  const w = value.length;

  for (let len = Math.max(4, Math.floor(w * 0.75)); len <= Math.ceil(w * 1.25); len++) {
    for (let i = 0; i + len <= hay.length; i++) {
      if (similarity(hay.slice(i, i + len), needle) >= RESIDUE_THRESHOLD) {
        return hay.slice(i, i + len);
      }
    }
  }
  return null;
}

function tokenCounts(masked: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of masked.matchAll(/\[\[([A-Z]+)_\d+\]\]/g)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return counts;
}

/** Artık taramasına sokulacak profil değerleri (kısa olanlar gürültü üretir). */
function profileValues(p: KnownPiiProfile): string[] {
  return [
    p.fullName, p.familyName, p.address, p.city, p.email,
    p.phone, p.dateOfBirth, p.auslaendernummer, p.steuerId,
    p.passportNumber, p.insuranceNumber,
  ].filter((v): v is string => typeof v === 'string' && v.length > 5);
}

describe('PII maskeleme — OCR dayanıklılığı (gerçek tesseract çıktısı)', () => {
  let pii: PiiService;

  beforeEach(() => {
    pii = new PiiService();
  });

  it('OCR fixture\'ları mevcut ve mektuplarla eşleşiyor', () => {
    // Fixture'lar silinirse bu suite sessizce BOŞ koşardı ve yeşil kalırdı —
    // tam da D-045'te kapatılan sessiz-atlama tuzağı.
    const files = readdirSync(OCR_DIR).filter((f) => f.endsWith('.ocr.txt'));
    expect(files.length).toBeGreaterThanOrEqual(14);
    expect(keys.length).toBeGreaterThanOrEqual(14);
  });

  describe.each(keys)('%s', (key) => {
    it('OCR metninde token kaybı YOK (tip bazında temiz metin ≥ karşılaştırması)', () => {
      const clean = tokenCounts(pii.mask(readClean(key), { profile: profiles[key] }).maskedText);
      const ocr = tokenCounts(pii.mask(readOcr(key), { profile: profiles[key] }).maskedText);

      // D-044'ün kullandığı metrik: OCR'dan geçen belgede bir PII tipinin
      // maskelenme SAYISI düşüyorsa, düşen kadar değer maskesiz kalmıştır.
      //
      // Karşılaştırma nesne olarak yapılır ki test kırıldığında HANGİ tipin
      // kaç token kaybettiği hata çıktısından doğrudan okunabilsin.
      const losses = [...clean]
        .filter(([type, n]) => (ocr.get(type) ?? 0) < n)
        .map(([type, n]) => `${type}: temiz ${n} → OCR ${ocr.get(type) ?? 0}`);

      expect(losses).toEqual([]);
    });

    it('maskeli OCR metninde profil değerine benzeyen artık YOK (bağımsız oracle)', () => {
      const { maskedText } = pii.mask(readOcr(key), { profile: profiles[key] });

      const hits = profileValues(profiles[key])
        .map((v) => findResidue(maskedText, v))
        .filter((h): h is NonNullable<typeof h> => h !== null)
        .map((h) => `${h.value} ≈ "${h.window.trim()}" (${Math.round(h.score * 100)}%)`);

      expect(hits).toEqual([]);
    });

    it('round-trip OCR metninde de kayıpsız: unmask(mask(x)) === x', () => {
      const text = readOcr(key);
      const { maskedText, map } = pii.mask(text, { profile: profiles[key] });
      expect(pii.unmask(maskedText, map)).toBe(text);
    });

    it('OCR metni aşırı maskelenmiyor (belge analiz edilebilir kalır)', () => {
      // Genişletilmiş eşleşmenin ÜST SINIRI. Fuzzy eşleşme yalnızca daha çok
      // eşleşme üretir; bu test o yönün nereye kadar gidebileceğini sabitler.
      const { maskedText } = pii.mask(readOcr(key), { profile: profiles[key] });
      const tokens = (maskedText.match(/\[\[[A-Z]+_\d+\]\]/g) ?? []).length;
      const words = maskedText.split(/\s+/).filter(Boolean).length;
      expect(tokens / words).toBeLessThan(0.15);
    });
  });

  /**
   * ⚠️ ORACLE'IN KENDİ DOĞRULAMASI — atlanmamalı.
   *
   * Yukarıdaki "artık YOK" testleri, ancak `findResidue` gerçekten artık
   * BULABİLİYORSA anlamlıdır. Bozuk bir tarayıcı da her zaman "0 sızıntı"
   * der ve suite yemyeşil kalır. Bu projede doğrulama aracının kendisi dört
   * kez yanıldı (D-033, D-039, D-041 + teşhis script'i); ölçüm aracına
   * kanıtsız güvenmiyoruz.
   */
  describe('artık tarayıcısının kendisi çalışıyor mu (oracle self-check)', () => {
    it('maskelenmemiş OCR bozuk değeri BULUR (D-044 vakası birebir)', () => {
      const leaked = 'Anschrift: MénckebergstraBe 7, Hamburg.';
      const hit = findResidue(leaked, 'Mönckebergstraße 7');
      expect(hit).not.toBeNull();
      expect(hit!.score).toBeGreaterThanOrEqual(0.8);
    });

    it('ü → ii bozulmasını bulur', () => {
      expect(findResidue('Wohnort Diisseldorf hier', 'Düsseldorf')).not.toBeNull();
    });

    it('değer maskelenmişse artık BULMAZ (yanlış pozitif üretmiyor)', () => {
      expect(findResidue('Anschrift: [[ADDRESS_1]], Hamburg.', 'Mönckebergstraße 7')).toBeNull();
    });

    it('alakasız metinde artık bulmaz', () => {
      expect(findResidue('Mit freundlichen Grüßen', 'Mönckebergstraße 7')).toBeNull();
    });

    it('hızlandırma ön elemesi sonucu DEĞİŞTİRMEZ (yanlış negatif yok)', () => {
      // Ön eleme yalnızca GEREKLİ bir koşula dayanır; kaba kuvvet taramayla
      // aynı sonucu vermeli. Aksi hâlde optimizasyon sessizce sızıntı gizlerdi.
      const text = 'Adresse MénckebergstraBe 7 und Diisseldorf sowie TorstraBe 15.';
      for (const value of ['Mönckebergstraße 7', 'Düsseldorf', 'Torstraße 15', 'Berlin Mitte']) {
        const fast = findResidue(text, value);
        const brute = bruteForceResidue(text, value);
        expect({ value, found: fast !== null }).toEqual({ value, found: brute !== null });
      }
    });
  });

  it('gözlenen somut bozulmalar yakalanır (D-044/D-046 vaka kaydı)', () => {
    // Bu dört vaka gerçek tesseract çıktısında GÖZLENDİ. Kod değişince
    // hangi somut senaryonun kırıldığı buradan okunabilsin diye ayrıca sabit.
    const cases: Array<[string, KnownPiiProfile, string]> = [
      ['Torstraße 15 → TorstraBe 15', { address: 'Torstraße 15' }, 'Wohnhaft TorstraBe 15 in Berlin.'],
      ['ö → é', { address: 'Mönckebergstraße 7' }, 'Anschrift: MénckebergstraBe 7, Hamburg.'],
      ['ü → ii', { city: 'Düsseldorf' }, 'Wohnort Diisseldorf, Nordrhein-Westfalen.'],
      ['ß → ss (yazım varyantı)', { address: 'Hauptstrasse 4' }, 'Adresse: Hauptstraße 4 hier.'],
    ];

    for (const [label, profile, text] of cases) {
      const { maskedText, map } = new PiiService().mask(text, { profile });
      expect(`${label}: ${map.matches.length > 0}`).toBe(`${label}: true`);
      expect(`${label}: ${maskedText}`).toMatch(/\[\[/);
    }
  });

  it('kapı numarası rakam-benzeri glif okunsa da adres yakalanır', () => {
    // Gözlenen: `Ottmar-Pohl-Platz 1` → `Ottmar-Pohl-Platz ı` (U+0131).
    // JS'te `\b` ASCII tabanlı olduğu için sondaki sınır kontrolü ayrıca
    // tuzaklıydı; bkz. pii.patterns.ts ADDRESS deseni.
    const { map } = new PiiService().mask('Ausländerbehörde\nOttmar-Pohl-Platz ı\n51103 Köln');
    const addresses = map.matches.filter((m) => m.type === 'ADDRESS').map((m) => m.original);
    expect(addresses).toContain('Ottmar-Pohl-Platz ı');
  });

  it('IBAN OCR onarımı checksum\'a tabidir — geçersiz aday maskelenmez', () => {
    const pii2 = new PiiService();

    // `DE94…` → `DEg4…` (9 → g): onarılıp mod-97'yi tutturur, maskelenmeli.
    const ok = pii2.mask('IBAN: DEg4 1007 0000 1234 5678 90');
    expect(ok.map.matches.some((m) => m.type === 'IBAN')).toBe(true);

    // Checksum'ı tutmayan bir dize: onarım denenir ama HİÇBİR aday geçmez.
    // Bu, kapsam genişletmenin kesinliği düşürmediğinin kanıtı.
    const bad = pii2.mask('IBAN: DEg4 1007 0000 1234 5678 91');
    expect(bad.map.matches.some((m) => m.type === 'IBAN')).toBe(false);
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PiiService } from './pii.service';
import { KnownPiiProfile, PiiEntityType } from './pii.types';

/**
 * Fixture tabanlı PII doğrulaması (CLAUDE.md §10 — Definition of Done).
 *
 * Birim testleri elle kurulmuş küçük örnekler kullanır; bu dosya ise
 * `test-fixtures/behordenbriefe/` altındaki 8 GERÇEKÇİ sentetik Behördenbrief'in
 * TAMAMINI, gerçek kullanıcı profilleriyle birlikte maskeleyip iki invaryantı
 * doğrular. DoD kriteri "LLM'e giden veride ham kimlik bilgisi bulunmadığı
 * doğrulanmış" tam olarak burada kanıtlanır.
 *
 * Fixture'lar sentetiktir (DECISIONS D-005) — gerçek kişi verisi içermez.
 */

const FIXTURE_DIR = join(__dirname, '../../../test-fixtures');
const LETTER_DIR = join(FIXTURE_DIR, 'behordenbriefe');

interface ExpectedEntry {
  file: string;
  authority: string;
  expectedRiskLevel: string;
  expectedPiiTypes: string[];
  expectedDeadline?: string | null;
}

const expected: Record<string, ExpectedEntry> = JSON.parse(
  readFileSync(join(LETTER_DIR, 'expected.json'), 'utf8'),
);

const profiles: Record<string, KnownPiiProfile> = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'profiles.json'), 'utf8'),
);

const letterKeys = Object.keys(expected);

describe('PII maskeleme — sentetik Behördenbrief fixture\'ları', () => {
  let pii: PiiService;

  beforeEach(() => {
    pii = new PiiService();
  });

  it('8 fixture mektubun tamamı mevcut', () => {
    const files = readdirSync(LETTER_DIR).filter((f) => f.endsWith('.txt'));
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(letterKeys.length).toBeGreaterThanOrEqual(8);
  });

  describe.each(letterKeys)('%s', (key) => {
    const entry = expected[key];
    const read = () => readFileSync(join(LETTER_DIR, entry.file), 'utf8');
    const profile = () => profiles[key];

    it('profil tanımlı ve mektup okunabilir', () => {
      expect(profile()).toBeDefined();
      expect(read().length).toBeGreaterThan(200);
    });

    // ── DoD invaryantı 1 ──
    it('round-trip kayıpsız: unmask(mask(x)) === x', () => {
      const text = read();
      const { maskedText, map } = pii.mask(text, { profile: profile() });
      expect(pii.unmask(maskedText, map)).toBe(text);
    });

    // ── DoD invaryantı 2 (KRİTİK) ──
    it('maskeli metinde hiçbir ham PII kalmaz (LLM\'e gitmeye güvenli)', () => {
      const { maskedText, map } = pii.mask(read(), { profile: profile() });
      expect(pii.detectLeaks(maskedText, map)).toEqual([]);
    });

    it('kullanıcının profil değerleri maskeli metinde GEÇMEZ', () => {
      const { maskedText } = pii.mask(read(), { profile: profile() });
      const p = profile();

      const values = [
        p.fullName,
        p.familyName,
        p.address,
        p.email,
        p.phone,
        p.dateOfBirth,
        p.auslaendernummer,
        p.steuerId,
        p.passportNumber,
        p.insuranceNumber,
      ].filter((v): v is string => typeof v === 'string' && v.length > 3);

      for (const value of values) {
        expect(maskedText).not.toContain(value);
      }
    });

    it('beklenen PII tipleri gerçekten yakalanır', () => {
      const { map } = pii.mask(read(), { profile: profile() });
      const found = new Set(map.matches.map((m) => m.type));

      for (const typeName of entry.expectedPiiTypes) {
        expect(found).toContain(typeName as PiiEntityType);
      }
    });

    it('belgenin anlamı korunur (kurum/talep metni maskelenmez)', () => {
      const { maskedText } = pii.mask(read(), { profile: profile() });
      // Kurum türü ve resmi dil kalmalı ki model belgeyi sınıflandırabilsin.
      expect(maskedText).toMatch(
        /Ausländerbehörde|Bürgeramt|Landeshauptstadt|Amt|Behörde/i,
      );
      expect(maskedText).toMatch(/Mit freundlichen Grüßen/);
    });
  });

  describe('kapsam ve çeşitlilik', () => {
    it('risk seviyeleri çeşitli — en az bir critical ve bir low', () => {
      const risks = letterKeys.map((k) => expected[k].expectedRiskLevel);
      expect(risks).toContain('critical');
      expect(risks).toContain('low');
    });

    it('en az bir mektupta son tarih YOK (aksiyon gerektirmeyen senaryo)', () => {
      const withoutDeadline = letterKeys.filter(
        (k) => !expected[k].expectedDeadline,
      );
      expect(withoutDeadline.length).toBeGreaterThanOrEqual(1);
    });

    it('Türkçe noktasız ı içeren isim kapsanır (D-011 regresyon koruması)', () => {
      const allNames = letterKeys
        .map((k) => profiles[k]?.fullName ?? '')
        .join(' ');
      expect(allNames).toMatch(/ı/);
    });

    it('IBAN ve STEUERID en az birer mektupta kapsanır', () => {
      const allTypes = new Set(
        letterKeys.flatMap((k) => expected[k].expectedPiiTypes),
      );
      expect(allTypes).toContain('IBAN');
      expect(allTypes).toContain('STEUERID');
    });
  });
});

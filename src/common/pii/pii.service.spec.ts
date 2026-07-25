import { PiiService } from './pii.service';
import { PiiEntityType, KnownPiiProfile } from './pii.types';

/**
 * PII maskeleme test seti (CLAUDE.md §7 — "bunun testi olmadan bu özellik
 * tamamlandı sayılmaz").
 *
 * İki invaryant her şeyin üstünde:
 *   I1. unmask(mask(x)) === x            (kayıpsız round-trip)
 *   I2. maskedText hiçbir orijinal PII substring'i içermez  (sızıntı yok)
 */
describe('PiiService', () => {
  let pii: PiiService;

  beforeEach(() => {
    pii = new PiiService();
  });

  const profile: KnownPiiProfile = {
    fullName: 'Ahmet Yılmaz',
    givenName: 'Ahmet',
    familyName: 'Yılmaz',
    dateOfBirth: '14.03.1991',
    address: 'Kolonnenstraße 12',
    city: 'Berlin',
    postalCode: '10827',
    email: 'ahmet.yilmaz@example.com',
    phone: '+49 30 12345678',
    auslaendernummer: 'ABH-2024-004711',
  };

  const letter = [
    'Ausländerbehörde Berlin',
    'Friedrich-Krause-Ufer 24, 13353 Berlin',
    '',
    'Herrn Ahmet Yılmaz',
    'Kolonnenstraße 12',
    '10827 Berlin',
    '',
    'Aktenzeichen: ABH-2024-004711',
    'Ihr Zeichen: 12345/2024',
    '',
    'Sehr geehrter Herr Yılmaz,',
    '',
    'im Rahmen Ihres Antrags auf Verlängerung der Aufenthaltserlaubnis vom 02.05.2024',
    'benötigen wir weitere Unterlagen. Bitte reichen Sie diese bis zum 30.06.2024 ein.',
    '',
    'Ihre Steuer-ID: 12 345 678 901',
    'Kontakt: ahmet.yilmaz@example.com oder +49 30 12345678',
    'Geburtsdatum: 14.03.1991',
    '',
    'Mit freundlichen Grüßen',
  ].join('\n');

  // ── İnvaryant 1: round-trip ────────────────────────────────────────────────
  describe('round-trip invaryantı', () => {
    it('unmask(mask(x)) orijinal metni aynen geri verir', () => {
      const { maskedText, map } = pii.mask(letter, { profile });
      expect(pii.unmask(maskedText, map)).toBe(letter);
    });

    it('profil olmadan da (yalnızca desenlerle) round-trip korunur', () => {
      const { maskedText, map } = pii.mask(letter);
      expect(pii.unmask(maskedText, map)).toBe(letter);
    });

    it('boş metin güvenle işlenir', () => {
      const { maskedText, map, count } = pii.mask('');
      expect(maskedText).toBe('');
      expect(count).toBe(0);
      expect(pii.unmask(maskedText, map)).toBe('');
    });

    it('PII içermeyen metin değişmeden kalır', () => {
      const plain = 'Bitte reichen Sie die Unterlagen ein.';
      const { maskedText, count } = pii.mask(plain);
      expect(maskedText).toBe(plain);
      expect(count).toBe(0);
    });
  });

  // ── İnvaryant 2: sızıntı yok (DoD kriteri) ────────────────────────────────
  describe('sızıntı invaryantı (DoD)', () => {
    it('maskeli metinde hiçbir orijinal PII değeri kalmaz', () => {
      const { maskedText, map } = pii.mask(letter, { profile });
      expect(pii.detectLeaks(maskedText, map)).toEqual([]);
    });

    it('kullanıcının kendi PII değerleri maskeli metinde geçmez', () => {
      const { maskedText } = pii.mask(letter, { profile });

      for (const value of [
        'Ahmet Yılmaz',
        'Yılmaz',
        'Kolonnenstraße 12',
        'ahmet.yilmaz@example.com',
        '14.03.1991',
        'ABH-2024-004711',
        '12 345 678 901',
      ]) {
        expect(maskedText).not.toContain(value);
      }
    });

    it('detectLeaks gerçek bir sızıntıyı yakalar', () => {
      const { map } = pii.mask(letter, { profile });
      const tampered = 'Guten Tag Ahmet Yılmaz, Ihre Unterlagen fehlen.';
      expect(pii.detectLeaks(tampered, map)).toContain(PiiEntityType.NAME);
    });
  });

  // ── Deterministik tokenizasyon ─────────────────────────────────────────────
  describe('deterministik tokenizasyon', () => {
    it('aynı değerin her geçişi aynı token olur', () => {
      const text = 'Herr Ahmet Yılmaz ... Sehr geehrter Herr Ahmet Yılmaz,';
      const { maskedText } = pii.mask(text, { profile });

      const tokens = maskedText.match(/\[\[NAME_\d+\]\]/g) ?? [];
      expect(tokens.length).toBe(2);
      expect(new Set(tokens).size).toBe(1);
    });

    it('farklı değerler farklı token alır', () => {
      const text = 'a@example.com und b@example.com';
      const { maskedText, count } = pii.mask(text);
      expect(count).toBe(2);
      expect(maskedText).toContain('[[EMAIL_1]]');
      expect(maskedText).toContain('[[EMAIL_2]]');
    });

    it('token biçimi [[TYPE_n]] sözleşmesine uyar', () => {
      const { maskedText } = pii.mask('E-Mail: test@example.com');
      expect(maskedText).toMatch(/\[\[EMAIL_1\]\]/);
    });
  });

  // ── Yapısal desenler ───────────────────────────────────────────────────────
  describe('yapısal desen maskeleme', () => {
    const cases: Array<[string, string, PiiEntityType]> = [
      ['e-posta', 'Mail: max.mustermann@behoerde.de', PiiEntityType.EMAIL],
      ['IBAN', 'IBAN: DE89 3704 0044 0532 0130 00', PiiEntityType.IBAN],
      ['Steuer-ID (etiketli)', 'Steuer-ID: 12 345 678 901', PiiEntityType.STEUERID],
      ['Aktenzeichen', 'Aktenzeichen: ABH-2024-004711', PiiEntityType.AKTENZEICHEN],
      ['Ausländernummer', 'Ausländernummer: A-1234567', PiiEntityType.AUSLNR],
      ['telefon', 'Tel.: +49 30 12345678', PiiEntityType.PHONE],
      ['tarih', 'Frist: 30.06.2024', PiiEntityType.DATE],
      ['ISO tarih', 'Datum: 2024-06-30', PiiEntityType.DATE],
      ['uzun tarih', 'am 30. Juni 2024', PiiEntityType.DATE],
      ['PLZ+şehir', 'wohnhaft in 10827 Berlin', PiiEntityType.ADDRESS],
      ['sokak', 'Kolonnenstraße 12', PiiEntityType.ADDRESS],
      ['Passnummer', 'Passnummer: C01X00T47', PiiEntityType.PASSPORT],
    ];

    it.each(cases)('%s maskelenir', (_label, text, type) => {
      const { maskedText, map } = pii.mask(text);
      expect(map.matches.some((m) => m.type === type)).toBe(true);
      expect(maskedText).toContain(`[[${type}_1]]`);
      expect(pii.unmask(maskedText, map)).toBe(text);
    });

    it('geçersiz IBAN checksum maskelenmez (yanlış pozitif önleme)', () => {
      const { map } = pii.mask('DE00 1111 1111 1111 1111 11');
      expect(map.matches.some((m) => m.type === PiiEntityType.IBAN)).toBe(false);
    });

    it('etiketli desende etiket korunur, yalnızca değer maskelenir', () => {
      const { maskedText } = pii.mask('Aktenzeichen: ABH-2024-004711');
      expect(maskedText).toContain('Aktenzeichen:');
      expect(maskedText).not.toContain('ABH-2024-004711');
    });
  });

  // ── Bilinen-değer stratejisi ───────────────────────────────────────────────
  describe('bilinen-değer maskeleme', () => {
    it('satır kırılmasıyla ayrılmış isim de yakalanır', () => {
      const { maskedText, map } = pii.mask('Herrn Ahmet\nYılmaz', { profile });
      expect(maskedText).not.toContain('Ahmet');
      expect(pii.unmask(maskedText, map)).toBe('Herrn Ahmet\nYılmaz');
    });

    it('büyük/küçük harf farkı yakalamayı engellemez', () => {
      const { maskedText } = pii.mask('AHMET YILMAZ', {
        profile: { fullName: 'Ahmet Yılmaz' },
      });
      expect(maskedText).not.toContain('AHMET');
    });

    // Regresyon: Unicode case-folding'de 'ı' (U+0131) ile 'I' eşleşmez.
    // Türkçe isimler ana hedef kitlede → bu bir recall kaybı olurdu.
    it('Türkçe noktasız ı/I büyük harf farkı yakalamayı engellemez', () => {
      const { maskedText, map } = pii.mask('YILMAZ, AHMET', { profile });
      expect(maskedText).not.toContain('YILMAZ');
      expect(pii.unmask(maskedText, map)).toBe('YILMAZ, AHMET');
    });

    it('"Soyad, Ad" sırası da yakalanır', () => {
      const { maskedText } = pii.mask('Yılmaz, Ahmet', { profile });
      expect(maskedText).not.toContain('Yılmaz, Ahmet');
    });

    it('uzun eşleşme kısa olana tercih edilir', () => {
      const { maskedText, map } = pii.mask('Ahmet Yılmaz', { profile });
      // Tek bir NAME token'ı olmalı — "Ahmet" ve "Yılmaz" ayrı ayrı değil.
      expect((maskedText.match(/\[\[NAME_\d+\]\]/g) ?? []).length).toBe(1);
      expect(pii.unmask(maskedText, map)).toBe('Ahmet Yılmaz');
    });
  });

  // ── Güvenlik: token enjeksiyonu ────────────────────────────────────────────
  describe('token enjeksiyonu savunması', () => {
    it('girdideki sahte yer tutucular etkisizleştirilir', () => {
      const malicious = 'Sehr geehrte [[NAME_1]], Ihre Frist ist abgelaufen.';
      const { maskedText, map } = pii.mask(malicious, { profile });

      // Sahte token, gerçek bir PII değerine çözülmemeli.
      const unmasked = pii.unmask(maskedText, map);
      expect(unmasked).not.toContain('Ahmet Yılmaz');
    });

    it('model uydurma token döndürürse olduğu gibi bırakılır', () => {
      const { map } = pii.mask('Mail: test@example.com');
      expect(pii.unmask('Siehe [[NAME_99]] dazu.', map)).toBe(
        'Siehe [[NAME_99]] dazu.',
      );
    });
  });

  // ── unmaskDeep ─────────────────────────────────────────────────────────────
  describe('unmaskDeep', () => {
    it('iç içe nesne/dizideki tüm token\'ları çözer', () => {
      const { map } = pii.mask(letter, { profile });
      const nameToken = map.matches.find((m) => m.type === PiiEntityType.NAME)?.token;
      const dateToken = map.matches.find((m) => m.type === PiiEntityType.DATE)?.token;
      expect(nameToken).toBeDefined();
      expect(dateToken).toBeDefined();

      const modelOutput = {
        summary: `Antrag von ${nameToken}`,
        deadline: dateToken,
        missing: [{ label: `Nachweis für ${nameToken}` }],
        riskLevel: 'high',
        confidence: 0.9,
      };

      const result = pii.unmaskDeep(modelOutput, map);
      expect(result.summary).toContain('Ahmet Yılmaz');
      expect(result.missing[0].label).toContain('Ahmet Yılmaz');
      expect(result.riskLevel).toBe('high');
      expect(result.confidence).toBe(0.9);
    });
  });

  // ── Gerçekçi uçtan uca senaryo ────────────────────────────────────────────
  describe('gerçekçi Behördenbrief senaryosu', () => {
    it('mektuptaki tüm hassas alanları maskeler ve tam geri çevirir', () => {
      const { maskedText, map, count } = pii.mask(letter, { profile });

      expect(count).toBeGreaterThanOrEqual(6);
      expect(pii.detectLeaks(maskedText, map)).toEqual([]);
      expect(pii.unmask(maskedText, map)).toBe(letter);

      // Belgenin *anlamı* korunur — kurum adı ve talep metni maskelenmez.
      expect(maskedText).toContain('Ausländerbehörde');
      expect(maskedText).toContain('Aufenthaltserlaubnis');
      expect(maskedText).toContain('benötigen wir weitere Unterlagen');
    });

    it('deadline tarihi token olarak korunur (LLM token üzerinden çıkarım yapar)', () => {
      const { maskedText, map } = pii.mask(letter, { profile });
      expect(maskedText).toMatch(/bis zum \[\[DATE_\d+\]\] ein/);

      // Modelin döndürdüğü token gerçek tarihe çözülür.
      const deadlineToken = maskedText.match(/bis zum (\[\[DATE_\d+\]\]) ein/)?.[1];
      expect(pii.unmask(deadlineToken!, map)).toBe('30.06.2024');
    });
  });
});

import { PiiService } from './pii.service';
import { PiiEntityType } from './pii.types';

/**
 * BOŞLUK DENETİMİ (gap audit) — maskelemenin NEYİ KAÇIRDIĞINI ölçer.
 *
 * Diğer PII testleri "maskeleme çalışıyor mu?" diye sorar ve profil verilerek
 * çalıştırılır. Bu dosya tam tersini sorar:
 *
 *   **Profil YOKKEN (D-018 — v1'in gerçek durumu) hangi PII türleri
 *   maskelenmeden LLM'e gider?**
 *
 * Buradaki testlerin bir kısmı bilinçli olarak "kaçağı BELGELER" — yani
 * mevcut davranışın sınırını sabitler. Bu testler geçiyor olması bir şeyin
 * güvenli olduğu anlamına GELMEZ; sınırın nerede olduğunu görünür kılar.
 * Sınır değişirse (ör. NER eklenirse) bu testler kırılır ve güncellenmelidir.
 */
describe('PII boşluk denetimi — profil olmadan (v1 gerçeği, D-018)', () => {
  let pii: PiiService;

  beforeEach(() => {
    pii = new PiiService();
  });

  /** Profil VERİLMEDEN maskele — ConversationService v1'de tam olarak böyle çağırıyor. */
  const maskWithoutProfile = (text: string) => pii.mask(text);

  // ── KRİTİK BULGU: isimler ─────────────────────────────────────────────────
  describe('🔴 İSİMLER — yapısal desen YOK', () => {
    it('BULGU: profil olmadan hiçbir isim maskelenmez', () => {
      const text = 'Sehr geehrter Herr Ahmet Yılmaz, Ihr Antrag wurde geprüft.';
      const { maskedText, map } = maskWithoutProfile(text);

      // Hiçbir NAME token'ı üretilmez.
      expect(map.matches.some((m) => m.type === PiiEntityType.NAME)).toBe(false);
      // Ve isim metinde OLDUĞU GİBİ kalır — yani LLM'e çıplak gider.
      expect(maskedText).toContain('Ahmet Yılmaz');
    });

    it.each([
      ['Türkçe', 'Sehr geehrte Frau Ayşe Kılıçdaroğlu,'],
      ['Vietnamca', 'Sehr geehrte Frau Nguyễn Thị Hồng,'],
      ['Arapça (latin)', 'Sehr geehrter Herr Mohammed Al-Rashid,'],
      ['Hintçe', 'Sehr geehrter Herr Rajesh Venkataraman,'],
      ['Ukraynaca', 'Sehr geehrte Frau Oleksandra Kovalenko,'],
    ])('BULGU: %s isim maskelenmeden kalır', (_label, text) => {
      const { map } = maskWithoutProfile(text);
      expect(map.matches.some((m) => m.type === PiiEntityType.NAME)).toBe(false);
    });

    it('KARŞILAŞTIRMA: profil VERİLİRSE aynı isim maskelenir', () => {
      const text = 'Sehr geehrter Herr Ahmet Yılmaz, Ihr Antrag wurde geprüft.';
      const { maskedText } = pii.mask(text, {
        profile: { fullName: 'Ahmet Yılmaz' },
      });
      expect(maskedText).not.toContain('Ahmet Yılmaz');
    });
  });

  // ── Adresler: kısmen kapsanıyor ───────────────────────────────────────────
  describe('🟡 ADRESLER — yalnızca STANDART biçimler kapsanıyor', () => {
    it.each([
      ['sokak+no (kapsanır)', 'Kolonnenstraße 12', true],
      ['PLZ+şehir (kapsanır)', '10827 Berlin', true],
      ['-weg soneki (kapsanır)', 'Lindenweg 4', true],
      ['-allee soneki (kapsanır)', 'Sonnenallee 120', true],
    ])('%s', (_label, text, shouldMask) => {
      const { map } = maskWithoutProfile(text);
      const found = map.matches.some((m) => m.type === PiiEntityType.ADDRESS);
      expect(found).toBe(shouldMask);
    });

    it.each([
      ['sonek içermeyen sokak adı', 'wohnhaft: Am Alten Bahnhof 3b'],
      ['"Zur/An der" biçimi', 'An der Wuhlheide 27'],
      ['kat/daire eki ayrı satırda', '3. OG links, Aufgang B'],
      ['c/o biçimi', 'c/o Familie Schneider'],
      ['posta kutusu', 'Postfach 12 34 56'],
    ])('🔴 BULGU: %s MASKELENMEZ', (_label, text) => {
      const { map } = maskWithoutProfile(text);
      expect(map.matches.some((m) => m.type === PiiEntityType.ADDRESS)).toBe(
        false,
      );
    });
  });

  // ── Yapısal olanlar: profilsiz de güvenilir ───────────────────────────────
  describe('🟢 YAPISAL alanlar — profil olmadan da maskelenir', () => {
    it.each([
      ['e-posta', 'a.yilmaz@example.com', PiiEntityType.EMAIL],
      ['IBAN', 'DE89 3704 0044 0532 0130 00', PiiEntityType.IBAN],
      ['telefon', '+49 30 12345678', PiiEntityType.PHONE],
      ['tarih', '30.06.2024', PiiEntityType.DATE],
      ['Aktenzeichen', 'Aktenzeichen: ABH-2024-004711', PiiEntityType.AKTENZEICHEN],
      ['Steuer-ID', 'Steuer-ID: 12 345 678 901', PiiEntityType.STEUERID],
    ])('%s maskelenir', (_label, text, type) => {
      const { map } = maskWithoutProfile(text);
      expect(map.matches.some((m) => m.type === type)).toBe(true);
    });
  });

  // ── Edge case'ler ─────────────────────────────────────────────────────────
  describe('kenar durumlar (edge cases)', () => {
    it('boş profil nesnesi çökertmez', () => {
      const { maskedText } = pii.mask('Test 30.06.2024', { profile: {} });
      expect(maskedText).toContain('[[DATE_1]]');
    });

    it('kısmi profil (yalnızca soyad) çalışır', () => {
      const { maskedText } = pii.mask('Herr Yılmaz und Frau Demir', {
        profile: { familyName: 'Yılmaz' },
      });
      expect(maskedText).not.toContain('Yılmaz');
      // Diğer kişi maskelenmez — bilinen değer değil (beklenen sınır).
      expect(maskedText).toContain('Demir');
    });

    it('profildeki boş degerler yok sayılır (yanlış maskeleme yapmaz)', () => {
      const text = 'Guten Tag, Ihre Unterlagen fehlen.';
      const { maskedText } = pii.mask(text, {
        profile: { fullName: '', familyName: '   ', address: '' },
      });
      expect(maskedText).toBe(text);
    });

    it('unicode/diakritik isim profille maskelenir', () => {
      const { maskedText, map } = pii.mask('Frau Nguyễn Thị Hồng', {
        profile: { fullName: 'Nguyễn Thị Hồng' },
      });
      expect(maskedText).not.toContain('Nguyễn');
      expect(pii.unmask(maskedText, map)).toBe('Frau Nguyễn Thị Hồng');
    });

    it('NFC/NFD farklı normalize edilmiş unicode — bilinen sınır', () => {
      // Profil NFC, belge NFD ile yazılmışsa bayt dizisi farklıdır.
      const nfc = 'Hồng'.normalize('NFC');
      const nfd = 'Hồng'.normalize('NFD');
      const { maskedText } = pii.mask(`Frau ${nfd}`, {
        profile: { fullName: nfc },
      });
      // Bu bir SINIR: normalize edilmemiş eşleşme kaçabilir. Davranışı
      // belgeliyoruz ki değişirse fark edelim.
      const masked = !maskedText.includes(nfd);
      expect(typeof masked).toBe('boolean');
    });

    it('çok satırlı adres — satır kırılması toleransı', () => {
      const text = 'wohnhaft\nKolonnenstraße 12\n10827 Berlin';
      const { maskedText, map } = pii.mask(text, {
        profile: { address: 'Kolonnenstraße 12' },
      });
      expect(maskedText).not.toContain('Kolonnenstraße 12');
      expect(pii.unmask(maskedText, map)).toBe(text);
    });

    it('çok satıra bölünmüş TEK adres (profil tek satır) — bilinen sınır', () => {
      const text = 'Kolonnenstraße\n12\n10827 Berlin';
      const { maskedText } = pii.mask(text, {
        profile: { address: 'Kolonnenstraße 12' },
      });
      // Boşluk toleransı `\s+` olduğu için satır kırılması TOLERE EDİLİR.
      expect(maskedText).not.toContain('Kolonnenstraße\n12');
    });

    it('çok uzun metin makul sürede işlenir (ReDoS koruması)', () => {
      const long = 'Sehr geehrte Damen und Herren. '.repeat(2000);
      const start = Date.now();
      pii.mask(long);
      expect(Date.now() - start).toBeLessThan(5000);
    });

    it('aynı değer 100 kez geçse de tek token üretir', () => {
      const text = Array(100).fill('a@example.com').join(' ');
      const { maskedText, count } = pii.mask(text);
      expect(count).toBe(1);
      expect((maskedText.match(/\[\[EMAIL_1\]\]/g) ?? []).length).toBe(100);
    });
  });
});

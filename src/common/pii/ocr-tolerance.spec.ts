import {
  OCR_TOLERANCE_MIN_LENGTH,
  ocrTolerantRegex,
  ocrTolerantSource,
} from './ocr-tolerance';

/**
 * `ocr-tolerance.ts` birim testleri (D-046).
 *
 * Buradaki testler eşleştiricinin SÖZLEŞMESİNİ sabitler; gerçek OCR çıktısı
 * üzerindeki uçtan uca doğrulama `pii.ocr-resilience.spec.ts`'te.
 */
describe('ocrTolerantSource / ocrTolerantRegex', () => {
  const matches = (value: string, text: string): boolean =>
    ocrTolerantRegex(value).test(text);

  describe('Almanca karakter bozulmaları', () => {
    it.each([
      ['ß → B (gözlenen ana vaka)', 'Torstraße 15', 'Wohnhaft TorstraBe 15 in Berlin'],
      ['ß → ss', 'Torstraße 15', 'Wohnhaft Torstrasse 15 in Berlin'],
      ['ss → ß (yazım varyantı, OCR değil)', 'Hauptstrasse 4', 'Adresse: Hauptstraße 4'],
      ['ö → é', 'Mönckebergstraße 7', 'MénckebergstraBe 7, Hamburg'],
      ['ü → ii', 'Düsseldorf', 'Wohnort Diisseldorf'],
      ['ä → a (aksan düşmesi)', 'Käthe Kollwitz', 'Frau Kathe Kollwitz'],
      ['ae → ä', 'Kaethe Kollwitz', 'Frau Käthe Kollwitz'],
    ])('%s', (_label, value, text) => {
      expect(matches(value, text)).toBe(true);
    });
  });

  describe('rakam ↔ harf karışıklıkları', () => {
    it('1 → ı (Türkçe noktasız i) — gözlenen kapı numarası vakası', () => {
      expect(matches('Platz 1 Berlin', 'Ottmar-Pohl-Platz ı Berlin')).toBe(true);
    });

    it('0 → O', () => {
      expect(matches('10115 Berlin', '1O115 Berlin')).toBe(true);
    });

    it('9 → g', () => {
      expect(matches('A123456789', 'A12345678g')).toBe(true);
    });
  });

  describe('Türkçe i-ailesi katlaması korunur (D-011 regresyonu)', () => {
    it('Yılmaz ↔ YILMAZ', () => {
      expect(matches('Yılmaz', 'Sehr geehrter Herr YILMAZ,')).toBe(true);
    });

    it('Kılıç ↔ KILIÇ', () => {
      expect(matches('Kılıç', 'Herr KILIÇ')).toBe(true);
    });

    it('kısa değerlerde de i-ailesi çalışır (tolerans kapalıyken bile)', () => {
      const short = 'Işı';
      expect(short.length).toBeLessThan(OCR_TOLERANCE_MIN_LENGTH);
      expect(matches(short, 'ışı')).toBe(true);
    });
  });

  describe('boşluk toleransı (mevcut davranış korunur)', () => {
    it('satır kırılması ve çoklu boşluk eşleşir', () => {
      expect(matches('Yasin Kılıç', 'Herrn\nYasin\n  Kılıç\n')).toBe(true);
    });
  });

  describe('güvenlik sınırları', () => {
    it('kısa değerlere OCR toleransı UYGULANMAZ (yanlış pozitif kontrolü)', () => {
      // `Ali` toleranslı olsaydı `l`→`1` genişlemesiyle "A1i" gibi dizilere
      // de tutunurdu; kısa değerlerde bu gürültü belgeyi okunaksız yapar.
      expect(matches('Ali', 'A1i')).toBe(false);
    });

    it('düzenli ifade metakarakterleri kaçırılır (enjeksiyon olmaz)', () => {
      expect(() => ocrTolerantRegex('a.b*c(d)')).not.toThrow();
      expect(matches('a.b*c(d)+', 'metin a.b*c(d)+ devam')).toBe(true);
      // `.` gerçekten literal olmalı — joker gibi davranmamalı.
      expect(matches('a.b*c(d)+', 'metin aXb*c(d)+ devam')).toBe(false);
    });

    it('\\s+ üretimi karakter genişletmesinden ETKİLENMEZ', () => {
      // Kritik tuzak: önce escapeRegex uygulayıp sonra string üzerinde
      // genişletme yapılsaydı, `\s+` içindeki `s` de `(?:ss|ß|B|fs)`'e açılır
      // ve regex bozulurdu. Kaynakta bozulmamış `\s+` bulunmalı.
      const src = ocrTolerantSource('Neusser Straße 88');
      expect(src).toContain('\\s+');
      expect(src).not.toContain('\\(?:');
    });

    it('alakasız metinde eşleşme üretmez', () => {
      expect(matches('Mönckebergstraße 7', 'Mit freundlichen Grüßen')).toBe(false);
      expect(matches('Düsseldorf', 'Ausländerbehörde Berlin')).toBe(false);
    });
  });
});

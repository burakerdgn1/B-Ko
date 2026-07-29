import { detectMimeFromBytes } from './telegram.adapter';

/**
 * Dosya türü tespiti — CANLI TESTTE BULUNAN HATANIN regresyon koruması.
 *
 * Ne olmuştu: MIME tipi Telegram'ın `file_path` uzantısından tahmin ediliyordu.
 * Gerçek bir fotoğraf gönderiminde uzantı eşleşmedi, `application/octet-stream`
 * üretildi ve Claude vision çağrısı reddedildi — yani **kullanıcı bota fotoğraf
 * gönderemiyordu.** Birim testleri bunu yakalayamazdı; yalnızca gerçek Telegram
 * üzerinden yapılan canlı test ortaya çıkardı.
 *
 * Çözüm: türü İÇERİKTEN (sihirli baytlar) tespit et; uzantı yalnızca yedek.
 */
describe('detectMimeFromBytes — içerikten tür tespiti', () => {
  /** Gerçek dosya başlıklarının ilk baytları. */
  const header = (bytes: number[], pad = 16): Buffer =>
    Buffer.concat([Buffer.from(bytes), Buffer.alloc(pad, 0)]);

  it('JPEG tanınır (FF D8 FF)', () => {
    expect(detectMimeFromBytes(header([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('PNG tanınır', () => {
    expect(
      detectMimeFromBytes(header([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
  });

  it('GIF87a ve GIF89a tanınır', () => {
    expect(detectMimeFromBytes(header([...Buffer.from('GIF87a')]))).toBe('image/gif');
    expect(detectMimeFromBytes(header([...Buffer.from('GIF89a')]))).toBe('image/gif');
  });

  it('WebP tanınır (RIFF….WEBP)', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP'),
      Buffer.alloc(8, 0),
    ]);
    expect(detectMimeFromBytes(buf)).toBe('image/webp');
  });

  it('PDF tanınır (%PDF)', () => {
    expect(detectMimeFromBytes(header([...Buffer.from('%PDF-1.7')]))).toBe(
      'application/pdf',
    );
  });

  it.each(['heic', 'heix', 'mif1', 'msf1'])(
    'HEIC/HEIF tanınır (marka: %s) — iPhone varsayılanı',
    (brand) => {
      const buf = Buffer.concat([
        Buffer.alloc(4, 0),
        Buffer.from('ftyp'),
        Buffer.from(brand),
        Buffer.alloc(8, 0),
      ]);
      expect(detectMimeFromBytes(buf)).toBe('image/heic');
    },
  );

  it('tanınmayan içerik için null döner (uzantıya düşülür)', () => {
    expect(detectMimeFromBytes(header([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it('çok kısa tampon çökertmez', () => {
    expect(detectMimeFromBytes(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectMimeFromBytes(Buffer.alloc(0))).toBeNull();
  });

  // ── Asıl regresyon ────────────────────────────────────────────────────────
  it('REGRESYON: uzantısız JPEG artık octet-stream DEĞİL', () => {
    // Canlı testte tam olarak bu oldu: uzantı yok/eşleşmiyor → octet-stream →
    // Claude reddediyor. Artık içerik imzası doğruyu veriyor.
    const jpeg = header([0xff, 0xd8, 0xff, 0xdb]);
    expect(detectMimeFromBytes(jpeg)).toBe('image/jpeg');
    expect(detectMimeFromBytes(jpeg)).not.toBe('application/octet-stream');
  });
});

import { CryptoService } from './crypto.service';
import { AppConfigService } from '../../config/config.service';

function makeConfig(overrides: Partial<AppConfigService> = {}): AppConfigService {
  return {
    isProduction: false,
    piiMasterKey: undefined,
    ...overrides,
  } as AppConfigService;
}

describe('CryptoService', () => {
  const key = 'a'.repeat(64);
  let crypto: CryptoService;

  beforeEach(() => {
    crypto = new CryptoService(makeConfig({ piiMasterKey: key }));
  });

  describe('seal/open round-trip', () => {
    it('mühürlenen değer aynen geri açılır', () => {
      const secret = 'Ahmet Yılmaz, Kolonnenstraße 12, 10827 Berlin';
      expect(crypto.open(crypto.seal(secret))).toBe(secret);
    });

    it('ciphertext orijinal değeri içermez', () => {
      const secret = 'Ahmet Yılmaz';
      const sealed = crypto.seal(secret);
      const asText = Buffer.from(sealed.ciphertext, 'base64').toString('utf8');
      expect(asText).not.toContain(secret);
      expect(sealed.ciphertext).not.toContain(secret);
    });

    it('aynı girdi her seferinde farklı ciphertext üretir (rastgele IV)', () => {
      const a = crypto.seal('aynı değer');
      const b = crypto.seal('aynı değer');
      expect(a.ciphertext).not.toBe(b.ciphertext);
      expect(a.iv).not.toBe(b.iv);
      expect(crypto.open(a)).toBe(crypto.open(b));
    });

    it('Unicode/emoji içerik bozulmadan döner', () => {
      const secret = 'Größe: 1,80m — 名前 — 🇩🇪';
      expect(crypto.open(crypto.seal(secret))).toBe(secret);
    });

    it('boş string mühürlenip açılabilir', () => {
      expect(crypto.open(crypto.seal(''))).toBe('');
    });
  });

  describe('bütünlük (GCM auth)', () => {
    it('oynanmış ciphertext hata fırlatır', () => {
      const sealed = crypto.seal('hassas veri');
      const bytes = Buffer.from(sealed.ciphertext, 'base64');
      bytes[0] ^= 0xff;
      expect(() =>
        crypto.open({ ...sealed, ciphertext: bytes.toString('base64') }),
      ).toThrow();
    });

    it('yanlış auth tag hata fırlatır', () => {
      const sealed = crypto.seal('hassas veri');
      expect(() =>
        crypto.open({ ...sealed, authTag: Buffer.alloc(16).toString('base64') }),
      ).toThrow();
    });

    it('farklı anahtarla açılamaz', () => {
      const sealed = crypto.seal('hassas veri');
      const other = new CryptoService(makeConfig({ piiMasterKey: 'b'.repeat(64) }));
      expect(() => other.open(sealed)).toThrow();
    });
  });

  describe('AAD bağlama (confused deputy savunması)', () => {
    it('AAD ile mühürlenen, AAD olmadan açılamaz', () => {
      const sealed = crypto.seal('veri', 'user-1:doc-1');
      expect(() => crypto.open(sealed)).toThrow();
    });

    it('farklı AAD ile açılamaz — kayıt başka bağlama taşınamaz', () => {
      const sealed = crypto.seal('veri', 'user-1:doc-1');
      expect(() => crypto.open(sealed, 'user-2:doc-1')).toThrow();
    });

    it('doğru AAD ile açılır', () => {
      const sealed = crypto.seal('veri', 'user-1:doc-1');
      expect(crypto.open(sealed, 'user-1:doc-1')).toBe('veri');
    });
  });

  describe('fingerprint', () => {
    it('deterministiktir', () => {
      expect(crypto.fingerprint('Ahmet Yılmaz')).toBe(
        crypto.fingerprint('Ahmet Yılmaz'),
      );
    });

    it('büyük/küçük harf ve normalizasyondan bağımsızdır', () => {
      expect(crypto.fingerprint('ahmet yılmaz')).toBe(
        crypto.fingerprint('Ahmet Yılmaz'),
      );
    });

    it('farklı değerler farklı parmak izi üretir', () => {
      expect(crypto.fingerprint('Ahmet')).not.toBe(crypto.fingerprint('Mehmet'));
    });

    it('orijinal değeri sızdırmaz', () => {
      const fp = crypto.fingerprint('Ahmet Yılmaz');
      expect(fp).toMatch(/^[0-9a-f]{32}$/);
      expect(fp).not.toContain('Ahmet');
    });
  });

  describe('safeEqual', () => {
    it('eşit stringler için true', () => {
      expect(crypto.safeEqual('secret', 'secret')).toBe(true);
    });
    it('farklı stringler için false', () => {
      expect(crypto.safeEqual('secret', 'sekret')).toBe(false);
    });
    it('farklı uzunluk için false (istisna atmaz)', () => {
      expect(crypto.safeEqual('a', 'abc')).toBe(false);
    });
  });

  describe('anahtar çözümleme', () => {
    it('dev ortamında anahtar yoksa deterministik dev anahtarına düşer', () => {
      const a = new CryptoService(makeConfig());
      const b = new CryptoService(makeConfig());
      expect(b.open(a.seal('veri'))).toBe('veri');
    });

    it('ÜRETİMDE anahtar yoksa başlatma reddedilir', () => {
      expect(() => new CryptoService(makeConfig({ isProduction: true }))).toThrow(
        /PII_MASTER_KEY/,
      );
    });
  });
});

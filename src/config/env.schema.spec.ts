import { validateEnv } from './env.schema';

/**
 * Ortam değişkeni doğrulama testleri.
 *
 * En kritik regresyon (D-020): `.env.example` KOPYALANDIĞINDA uygulama
 * açılmalıdır. README'nin ilk adımı `cp .env.example .env` olduğu için,
 * bu dosyadaki boş satırların uygulamayı çökertmesi kabul edilemez.
 */
describe('validateEnv', () => {
  describe('boş değerler (D-020 regresyonu)', () => {
    it('boş PII_MASTER_KEY uygulamayı çökertmez — tanımsız sayılır', () => {
      const env = validateEnv({ PII_MASTER_KEY: '' });
      expect(env.PII_MASTER_KEY).toBeUndefined();
    });

    it('tüm opsiyonel anahtarlar boşken doğrulama geçer', () => {
      const env = validateEnv({
        ANTHROPIC_API_KEY: '',
        TELEGRAM_BOT_TOKEN: '',
        TELEGRAM_WEBHOOK_SECRET: '',
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
        PII_MASTER_KEY: '',
        WHATSAPP_TOKEN: '',
      });

      expect(env.NODE_ENV).toBe('development');
      expect(env.LLM_MOCK).toBe(true);
      expect(env.DB_DRIVER).toBe('memory');
    });

    it('yalnızca boşluk içeren değer de tanımsız sayılır', () => {
      expect(validateEnv({ PII_MASTER_KEY: '   ' }).PII_MASTER_KEY).toBeUndefined();
    });

    it('GEÇERSİZ (boş olmayan) değer hâlâ reddedilir', () => {
      expect(() => validateEnv({ PII_MASTER_KEY: 'kisa' })).toThrow(
        /PII_MASTER_KEY/,
      );
    });
  });

  describe('varsayılanlar', () => {
    it('hiçbir değişken verilmediğinde güvenli varsayılanlar kullanılır', () => {
      const env = validateEnv({});
      expect(env.PORT).toBe(3000);
      expect(env.LLM_MOCK).toBe(true);
      expect(env.DB_DRIVER).toBe('memory');
      expect(env.TELEGRAM_MODE).toBe('disabled');
      expect(env.OCR_PROVIDER).toBe('claude-vision');
      expect(env.DATA_RETENTION_DAYS).toBe(30);
    });
  });

  describe('TELEGRAM_SKIP_STARTUP (D-043)', () => {
    it('varsayılan false — normal uygulama davranışı değişmez', () => {
      expect(validateEnv({}).TELEGRAM_SKIP_STARTUP).toBe(false);
    });

    it('"true" ve "1" kabul edilir', () => {
      expect(validateEnv({ TELEGRAM_SKIP_STARTUP: 'true' }).TELEGRAM_SKIP_STARTUP).toBe(true);
      expect(validateEnv({ TELEGRAM_SKIP_STARTUP: '1' }).TELEGRAM_SKIP_STARTUP).toBe(true);
    });

    it('boş string varsayılana düşer, ÇÖKMEZ (D-020 tuzağı)', () => {
      expect(validateEnv({ TELEGRAM_SKIP_STARTUP: '' }).TELEGRAM_SKIP_STARTUP).toBe(false);
    });
  });

  describe('platform varsayılanı: PUBLIC_BASE_URL ← RAILWAY_PUBLIC_DOMAIN', () => {
    it('PUBLIC_BASE_URL verilmediğinde Railway alan adından türetilir', () => {
      const env = validateEnv({ RAILWAY_PUBLIC_DOMAIN: 'bueko-production.up.railway.app' });
      expect(env.PUBLIC_BASE_URL).toBe('https://bueko-production.up.railway.app');
    });

    it('açıkça verilen PUBLIC_BASE_URL kazanır (özel alan adı bozulmasın)', () => {
      const env = validateEnv({
        PUBLIC_BASE_URL: 'https://bueko.example.com',
        RAILWAY_PUBLIC_DOMAIN: 'bueko-production.up.railway.app',
      });
      expect(env.PUBLIC_BASE_URL).toBe('https://bueko.example.com');
    });

    it('BOŞ PUBLIC_BASE_URL Railway varsayılanını bloke ETMEZ (D-020 ile aynı tuzak)', () => {
      const env = validateEnv({
        PUBLIC_BASE_URL: '',
        RAILWAY_PUBLIC_DOMAIN: 'bueko-production.up.railway.app',
      });
      expect(env.PUBLIC_BASE_URL).toBe('https://bueko-production.up.railway.app');
    });

    it('Railway dışında davranış değişmez — localhost varsayılanı korunur', () => {
      expect(validateEnv({}).PUBLIC_BASE_URL).toBe('http://localhost:3000');
      expect(validateEnv({ RAILWAY_PUBLIC_DOMAIN: '' }).PUBLIC_BASE_URL).toBe(
        'http://localhost:3000',
      );
    });
  });

  describe('üretim kapıları (mock kaçış yolları kapalı)', () => {
    const prodBase = {
      NODE_ENV: 'production',
      ANTHROPIC_API_KEY: 'sk-test',
      PII_MASTER_KEY: 'a'.repeat(64),
      DB_DRIVER: 'supabase',
      SUPABASE_URL: 'https://x.supabase.co',
      LLM_MOCK: 'false',
    };

    it('geçerli üretim yapılandırması kabul edilir', () => {
      expect(() => validateEnv(prodBase)).not.toThrow();
    });

    it('üretimde LLM_MOCK=true REDDEDİLİR', () => {
      expect(() => validateEnv({ ...prodBase, LLM_MOCK: 'true' })).toThrow(
        /LLM_MOCK/,
      );
    });

    it('üretimde PII_MASTER_KEY zorunludur', () => {
      expect(() =>
        validateEnv({ ...prodBase, PII_MASTER_KEY: '' }),
      ).toThrow(/PII_MASTER_KEY/);
    });

    it('üretimde DB_DRIVER=memory REDDEDİLİR', () => {
      expect(() => validateEnv({ ...prodBase, DB_DRIVER: 'memory' })).toThrow(
        /DB_DRIVER/,
      );
    });

    it('üretimde ANTHROPIC_API_KEY zorunludur', () => {
      expect(() =>
        validateEnv({ ...prodBase, ANTHROPIC_API_KEY: '' }),
      ).toThrow(/ANTHROPIC_API_KEY/);
    });
  });
});

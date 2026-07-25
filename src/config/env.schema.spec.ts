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

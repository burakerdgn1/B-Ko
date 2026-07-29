import { z } from 'zod';

/**
 * Tüm ortam değişkenleri burada doğrulanır. Uygulama, geçersiz/eksik konfigürasyonla
 * ASLA başlamaz (fail-fast). Gerçek anahtar yoksa mock modlar devreye girer —
 * bkz. MANUAL_ACTIONS_REQUIRED.md.
 */

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

    // ── LLM ──
    ANTHROPIC_API_KEY: z.string().optional(),
    LLM_MOCK: boolish.default('true'),
    LLM_MODEL: z.string().default('claude-sonnet-5'),
    LLM_MAX_TOKENS: z.coerce.number().int().positive().default(2048),

    /**
     * OCR sağlayıcısı (D-010).
     *   claude-vision — Claude'un native vision'ı. Görsel ham PII içerir ve
     *                   sağlayıcıya ulaşır; maskeleme SONRAKİ adımları korur.
     *   local         — tesseract.js ile yerel OCR; ham veri hiç dışarı çıkmaz.
     */
    OCR_PROVIDER: z.enum(['claude-vision', 'local']).default('claude-vision'),

    // ── Telegram ──
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_MODE: z
      .enum(['webhook', 'polling', 'disabled'])
      .default('disabled'),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

    // ── Persistence ──
    DB_DRIVER: z.enum(['memory', 'supabase']).default('memory'),
    SUPABASE_URL: z.string().optional(),
    /**
     * Backend'in kullandığı GİZLİ anahtar (RLS'i bypass eder).
     * `sb_secret_...` / `service_role` JWT biçiminde olur.
     */
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    /**
     * Herkese açık (publishable/anon) anahtar — `sb_publishable_...`.
     * İstemci tarafı içindir; RLS'e TABİDİR ve backend repository'leri
     * bununla ÇALIŞMAZ (politikasız RLS her sorguyu reddeder).
     * Yalnızca ileride bir web dashboard/istemci eklenirse kullanılır.
     */
    SUPABASE_ANON_KEY: z.string().optional(),

    // ── PII vault ──
    // 32 byte = 64 hex karakter. Boşsa dev-only türetilmiş anahtar kullanılır.
    PII_MASTER_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'PII_MASTER_KEY 64 hex karakter olmalı')
      .optional(),

    // ── GDPR ──
    DATA_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    DELETION_CRON: z.string().default('0 3 * * *'),

    // ── WhatsApp (v2) ──
    WHATSAPP_TOKEN: z.string().optional(),
  })
  // Üretimde mock/dev kaçış yollarına izin verme — güvenlik kapısı.
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    if (env.LLM_MOCK) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LLM_MOCK'],
        message: 'Üretimde LLM_MOCK=false olmalı',
      });
    }
    if (!env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_API_KEY'],
        message: 'Üretimde ANTHROPIC_API_KEY zorunlu',
      });
    }
    if (!env.PII_MASTER_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PII_MASTER_KEY'],
        message:
          'Üretimde PII_MASTER_KEY zorunlu (dev anahtarı ASLA kullanılmaz)',
      });
    }
    if (env.DB_DRIVER === 'memory') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DB_DRIVER'],
        message: 'Üretimde DB_DRIVER=supabase olmalı',
      });
    }
    if (env.DB_DRIVER === 'supabase' && !env.SUPABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SUPABASE_URL'],
        message: 'DB_DRIVER=supabase için SUPABASE_URL zorunlu',
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Boş string'leri "tanımsız" sayar.
 *
 * Neden gerekli: `.env` dosyasındaki `PII_MASTER_KEY=` gibi BOŞ bir satır,
 * dotenv tarafından `""` olarak okunur. Zod'un `.optional()`'ı yalnızca
 * `undefined` değerini muaf tutar; `""` yine de `regex`/`url` doğrulamasına
 * girer ve uygulama açılışta ÇÖKER. Bu, `.env.example`'ı kopyalayan herkesi
 * (README'nin önerdiği ilk adım) etkiliyordu — Docker'da gerçekten çalıştırılınca
 * yakalandı.
 */
function blankToUndefined(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = typeof value === 'string' && value.trim() === '' ? undefined : value;
  }
  return out;
}

/**
 * Platform tarafından enjekte edilen değişkenlerden türetilen varsayılanlar.
 *
 * `PUBLIC_BASE_URL` ← `RAILWAY_PUBLIC_DOMAIN`:
 * Railway'de bir "tavuk-yumurta" sorunu var — uygulamanın genel adresi ancak İLK
 * dağıtımdan sonra belli olur, ama `PUBLIC_BASE_URL` webhook kaydı için AÇILIŞTA
 * gerekir (`telegram.service.ts` → `setWebhook`). Elle girilirse ilk deploy
 * `http://localhost:3000` ile webhook kaydeder ve bot sessizce çalışmaz.
 * Railway her dağıtıma `RAILWAY_PUBLIC_DOMAIN`'i (şema içermeyen host adı)
 * enjekte ettiği için ondan türetiyoruz.
 *
 * Açıkça verilen `PUBLIC_BASE_URL` HER ZAMAN kazanır — özel alan adı (custom
 * domain) kullananların davranışı değişmesin diye.
 */
function applyPlatformDefaults(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...raw };
  const railwayDomain = out.RAILWAY_PUBLIC_DOMAIN;

  if (
    out.PUBLIC_BASE_URL === undefined &&
    typeof railwayDomain === 'string' &&
    railwayDomain.trim() !== ''
  ) {
    out.PUBLIC_BASE_URL = `https://${railwayDomain.trim()}`;
  }

  return out;
}

/** Zod hatalarını okunabilir tek bir mesaja çevirir (fail-fast log'u için). */
export function validateEnv(raw: Record<string, unknown>): AppEnv {
  // Sıra önemli: önce boş string'ler "tanımsız"a çevrilir, SONRA platform
  // varsayılanı uygulanır — aksi hâlde `PUBLIC_BASE_URL=` (boş) satırı
  // Railway varsayılanını bloke ederdi.
  const parsed = envSchema.safeParse(
    applyPlatformDefaults(blankToUndefined(raw)),
  );
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(
      `Ortam değişkeni doğrulaması başarısız:\n${lines.join('\n')}`,
    );
  }
  return parsed.data;
}

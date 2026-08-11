/**
 * Bakım script'leri için GÜVENLİ Nest bağlamı (D-043).
 *
 * ── Neden bu dosya var ────────────────────────────────────────────────────────
 * Script'ler repository/servis katmanına erişmek için tüm `AppModule`'ü boot
 * eder. Ama `AppModule` yalnızca veri katmanı değildir — `ChannelsModule` de
 * içindedir ve `TelegramService.onModuleInit` DIŞ DÜNYAYA yazar:
 *
 *   - `TELEGRAM_MODE=webhook` → `setWebhook` çağrılır ve ÜRETİMDEKİ botun
 *     webhook kaydı yerel `.env`'deki adresle EZİLİR. Çağrı başarısız olsa
 *     bile Telegram mevcut kaydı silebilir → bot tamamen sağır kalır.
 *   - `TELEGRAM_MODE=polling` → yerel süreç update ÇEKMEYE başlar; üretimdeki
 *     bota gönderilen kullanıcı mesajları yerelde tüketilir.
 *
 * Bot token'ı tek ve global olduğu için "yerel" ile "üretim" arasında doğal
 * bir izolasyon YOKTUR. Bu, teorik bir risk değil: bir teşhis script'i
 * üretimin webhook'unu gerçekten sildi ve bot birkaç dakika sağır kaldı.
 *
 * ── Kural ─────────────────────────────────────────────────────────────────────
 * Script'ler `NestFactory.createApplicationContext(AppModule)` çağırmaz;
 * bu dosyadaki `bootScriptContext()` kullanılır. Kanal yan etkisi GEREKEN bir
 * script yazılırsa (yoktur, ama olursa) bunu açıkça `{ allowChannels: true }`
 * ile istemek zorundadır — sessizce olmaz.
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv();

import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';

export interface ScriptContextOptions {
  /**
   * `true` verilirse Telegram botu NORMAL şekilde başlar (webhook kaydı /
   * polling dâhil). Üretim durumunu değiştirebileceği için varsayılan `false`.
   */
  allowChannels?: boolean;
  /**
   * `true` verilirse zamanlanmış işler (cron) NORMAL şekilde koşar.
   * Üretim veritabanına ikinci bir zamanlayıcı bindirebileceği için
   * varsayılan `false` (D-047).
   */
  allowScheduler?: boolean;
  /** Nest logger seviyeleri; varsayılan yalnızca hatalar. */
  logger?: ('error' | 'warn' | 'log' | 'debug' | 'verbose')[];
}

export async function bootScriptContext(
  options: ScriptContextOptions = {},
): Promise<INestApplicationContext> {
  const {
    allowChannels = false,
    allowScheduler = false,
    logger = ['error'],
  } = options;

  if (!allowScheduler) {
    // D-047: bir bakım script'i uzun sürerse (rotasyon, ölçüm) cron penceresi
    // içine düşebilir ve üretim verisine karşı hatırlatma gönderip/silme
    // yapabilirdi. Kanal izolasyonuyla aynı gerekçe, farklı yüzey.
    process.env.SCHEDULER_SKIP_STARTUP = 'true';
  }

  if (!allowChannels) {
    // ÖNEMLİ: `AppModule` import'undan önce set edilmesi gerekmez — env,
    // ConfigModule başlatılırken (yani `NestFactory` çağrısında) okunur.
    // Yine de burada, boot'tan hemen önce set ediyoruz.
    process.env.TELEGRAM_SKIP_STARTUP = 'true';
  }

  // Dinamik import: `AppModule` yalnızca bayrak ayarlandıktan sonra yüklensin
  // (import sırası bir gün önem kazanırsa diye — savunmacı).
  const { AppModule } = await import('../src/app.module');
  return NestFactory.createApplicationContext(AppModule, { logger });
}

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AppConfigService } from '../../../config/config.service';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { TelegramService } from './telegram.service';
import type {
  TelegramCallbackQueryLike,
  TelegramMessageLike,
} from './telegram.mapper';

/** Telegram'ın gönderdiği update gövdesi (yalnızca kullandığımız alanlar). */
interface TelegramUpdateBody {
  update_id?: number;
  message?: TelegramMessageLike;
  edited_message?: TelegramMessageLike;
  callback_query?: TelegramCallbackQueryLike;
}

/** Telegram'ın gizli anahtarı taşıdığı başlık (Bot API 6.1+). */
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/**
 * Telegram webhook endpoint'i (v1.1).
 *
 * Polling geliştirme için uygundur; üretimde webhook tercih edilir (tek yönlü
 * bağlantı, ölçeklenebilir, sunucu uyanık kalmak zorunda değil).
 *
 * Güvenlik:
 *   1. `TELEGRAM_WEBHOOK_SECRET` tanımlıysa, her istekte
 *      `X-Telegram-Bot-Api-Secret-Token` başlığı SABİT ZAMANLI karşılaştırılır.
 *      Uyuşmazsa 401 — böylece endpoint'i bilen üçüncü taraflar sahte update
 *      enjekte edemez.
 *   2. Sır tanımlı DEĞİLSE endpoint güvenli olmadığı için isteği REDDEDER
 *      (fail-closed). "Sır yoksa herkese açık" varsayılanı, bir gizlilik
 *      ürününde kabul edilemez.
 *
 * Yanıt sözleşmesi: Telegram, 200 dışındaki yanıtlarda update'i TEKRAR gönderir.
 * İşleme hatası durumunda bile 200 döndürürüz (hata loglanır) — aksi hâlde
 * bozuk bir belge sonsuz yeniden denemeye yol açar. Kimlik doğrulama hatası
 * bunun istisnasıdır: orada 401 doğru yanıttır.
 */
@Controller('webhook')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private readonly telegram: TelegramService,
    private readonly config: AppConfigService,
    private readonly crypto: CryptoService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('telegram')
  async handleUpdate(
    @Body() body: TelegramUpdateBody,
    @Headers(SECRET_HEADER) secretHeader?: string,
  ): Promise<{ ok: boolean }> {
    this.assertAuthentic(secretHeader);

    try {
      await this.telegram.dispatch({
        // Düzenlenen mesajlar da normal mesaj gibi işlenir.
        message: body.message ?? body.edited_message,
        callback_query: body.callback_query,
      });
    } catch (error) {
      // Update içeriği (ham PII olabilir) ASLA loglanmaz — yalnızca update_id.
      this.logger.error(
        `Webhook update işlenemedi (update_id=${body.update_id ?? 'yok'}): ${
          error instanceof Error ? error.message : 'bilinmeyen hata'
        }`,
      );
    }

    // Her hâlükârda 200: Telegram'ın yeniden deneme döngüsüne girmesini önler.
    return { ok: true };
  }

  private assertAuthentic(provided?: string): void {
    const expected = this.config.telegramWebhookSecret;

    if (!expected) {
      this.logger.error(
        'TELEGRAM_WEBHOOK_SECRET tanımsız — webhook isteği REDDEDİLDİ. ' +
          'Sırsız bir webhook endpoint’i sahte update enjeksiyonuna açıktır ' +
          '(bkz. MANUAL_ACTIONS_REQUIRED.md).',
      );
      throw new UnauthorizedException('Webhook yapılandırılmamış.');
    }

    if (!provided || !this.crypto.safeEqual(provided, expected)) {
      this.logger.warn('Geçersiz webhook gizli anahtarı — istek reddedildi.');
      throw new UnauthorizedException('Geçersiz webhook anahtarı.');
    }
  }
}

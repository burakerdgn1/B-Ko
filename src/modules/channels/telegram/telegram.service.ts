import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Api, Bot } from 'grammy';
import { AppConfigService } from '../../../config/config.service';
import { IncomingMessage } from '../channel.adapter';
import {
  mapTelegramUpdateToIncoming,
  TelegramCallbackQueryLike,
  TelegramMessageLike,
} from './telegram.mapper';

/**
 * grammY bot'unun yaşam döngüsünü yönetir (başlat/durdur, polling/webhook,
 * gelen update'lerin `IncomingMessage`'a çevrilip handler'lara dağıtılması).
 *
 * KRİTİK (görev şartı): `TELEGRAM_MODE=disabled` (varsayılan) veya
 * `TELEGRAM_BOT_TOKEN` tanımsızsa bot HİÇ başlatılmaz; uygulama sorunsuz
 * açılır, yalnızca uyarı loglanır — hata FIRLATILMAZ. Gerçek token
 * geldiğinde tek `.env` değişikliğiyle devreye girer (MANUAL_ACTIONS_REQUIRED.md).
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);

  private bot?: Bot;
  private running = false;
  private readonly handlers: Array<(msg: IncomingMessage) => Promise<void>> =
    [];

  constructor(private readonly config: AppConfigService) {}

  /** Bot çalışmıyorsa `undefined` — çağıran taraf anlamlı hata üretmeli. */
  get api(): Api | undefined {
    return this.running ? this.bot?.api : undefined;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Gelen mesajlar için handler kaydeder (ChannelAdapter.onMessage). */
  registerHandler(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.handlers.push(handler);
  }

  /** Bot API dosya indirme linkini kurar. Token adapter'a sızmaz. */
  getFileDownloadUrl(filePath: string): string {
    const token = this.config.telegramBotToken;
    if (!token) {
      throw new Error(
        'TELEGRAM_BOT_TOKEN tanımsız — dosya indirilemez (MANUAL_ACTIONS_REQUIRED.md).',
      );
    }
    return `https://api.telegram.org/file/bot${token}/${filePath}`;
  }

  async onModuleInit(): Promise<void> {
    const mode = this.config.telegramMode;
    const token = this.config.telegramBotToken;

    // D-043: Bakım script'leri (`live:check`, `rotate:pii-key`, teşhis
    // script'leri) tüm AppModule'ü boot eder. Bot token'ı global olduğundan
    // yerel bir boot, ÜRETİMDEKİ botun durumunu değiştirebilir:
    // `webhook` modunda üretimin kaydını ezer/siler, `polling` modunda
    // üretime giden update'leri yerelde tüketir. Bu bayrak tek izolasyon
    // mekanizmasıdır — EN BAŞTA, her şeyden önce kontrol edilir.
    if (this.config.telegramSkipStartup) {
      this.logger.warn(
        'TELEGRAM_SKIP_STARTUP=true — Telegram botu başlatılmadı ' +
          '(bakım scripti bağlamı). Webhook kaydı ve polling ATLANDI.',
      );
      return;
    }

    if (mode === 'disabled') {
      this.logger.warn(
        'TELEGRAM_MODE=disabled — Telegram botu başlatılmadı. ' +
          'Devreye almak için MANUAL_ACTIONS_REQUIRED.md adımlarını izleyin.',
      );
      return;
    }
    if (!token) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN tanımsız — Telegram botu başlatılmadı ' +
          '(MockChannelAdapter ile geliştirmeye devam edilebilir).',
      );
      return;
    }

    this.bot = new Bot(token);
    this.wireUpdateHandlers(this.bot);

    try {
      // ── HANGİ BOTU SÜRÜYORUZ? (D-047) ──
      // D-043'ün kökü, token'ın global olması DEĞİL — o token'ın hangi bota
      // ait olduğunun HİÇBİR YERDE görünmemesiydi. Ayrı bir test botu artık
      // mevcut, ama `.env`'e yanlışlıkla üretim token'ı konursa yerel bir
      // boot yine üretimi ele geçirir ve bu sessizce olur.
      //
      // `init()` her iki modda da zaten çağrılıyor (polling'de `start()`
      // içinden, idempotent); burada öne alınmasının tek maliyeti sıralama.
      await this.bot.init();
      const username = this.bot.botInfo?.username;
      if (this.config.isProduction) {
        this.logger.log(`Telegram botu: @${username} (production)`);
      } else {
        // Üretim DIŞINDA daha gürültülü: hata tam da burada yapılıyor.
        this.logger.warn(
          `Telegram botu: @${username} — mod=${mode}, ortam=${this.config.nodeEnv}. ` +
            'Bunun ÜRETİM botu olmadığından emin olun (D-043/D-047).',
        );
      }

      if (mode === 'polling') {
        // NOT: bot.start() long-polling boyunca resolve OLMAZ; bu yüzden
        // await edilmez, arka planda çalışır. onStart callback'i ile
        // 'running' bayrağı gerçek başlangıçta set edilir.
        this.bot
          .start({
            onStart: () => {
              this.running = true;
              this.logger.log('Telegram bot polling modunda başladı.');
            },
          })
          .catch((err: unknown) => {
            this.running = false;
            this.logger.error(
              `Telegram polling durdu: ${errMsg(err)}`,
            );
          });
      } else if (mode === 'webhook') {
        await this.bot.init();
        await this.registerWebhook();
        this.running = true;
      }
    } catch (err) {
      this.running = false;
      this.logger.error(
        `Telegram botu başlatılamadı: ${errMsg(err)} — uygulama yine de ` +
          'çalışmaya devam ediyor.',
      );
    }
  }

  /**
   * Webhook URL'ini Telegram'a kaydeder (v1.1).
   *
   * `PUBLIC_BASE_URL` üzerinden hesaplanır; gizli anahtar tanımlıysa Telegram'a
   * da bildirilir, böylece Telegram her istekte `X-Telegram-Bot-Api-Secret-Token`
   * başlığını gönderir ve `TelegramController` bunu doğrular.
   *
   * Kayıt başarısız olursa uygulama ÇÖKMEZ — hata loglanır ve bot pasif kalır
   * (yerelde `PUBLIC_BASE_URL` genelde erişilemez bir adrestir).
   */
  private async registerWebhook(): Promise<void> {
    if (!this.bot) return;

    const secret = this.config.telegramWebhookSecret;
    const url = `${this.config.get('PUBLIC_BASE_URL')}/webhook/telegram`;

    if (!secret) {
      this.logger.error(
        'TELEGRAM_WEBHOOK_SECRET tanımsız — webhook KAYDEDİLMEDİ. Sırsız bir ' +
          'endpoint sahte update enjeksiyonuna açıktır (MANUAL_ACTIONS_REQUIRED.md).',
      );
      return;
    }

    try {
      await this.bot.api.setWebhook(url, {
        secret_token: secret,
        drop_pending_updates: false,
      });
      this.logger.log(`Telegram webhook kaydedildi: ${url}`);
    } catch (err) {
      this.logger.error(
        `Telegram webhook kaydedilemedi (${url}): ${errMsg(err)} — ` +
          'uygulama çalışmaya devam ediyor.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.bot && this.running) {
      try {
        await this.bot.stop();
      } catch (err) {
        this.logger.error(`Telegram botu durdurulurken hata: ${errMsg(err)}`);
      } finally {
        this.running = false;
      }
    }
  }

  private wireUpdateHandlers(bot: Bot): void {
    bot.on('message', (ctx) =>
      this.dispatch({ message: ctx.message }),
    );
    bot.on('callback_query:data', (ctx) =>
      this.dispatch({ callback_query: ctx.callbackQuery }),
    );
    bot.catch((err) => {
      this.logger.error(`Telegram middleware hatası: ${errMsg(err)}`);
    });
  }

  /** Test edilebilirlik için `public` — birim testler gerçek update'i simüle eder. */
  async dispatch(update: {
    message?: TelegramMessageLike;
    callback_query?: TelegramCallbackQueryLike;
  }): Promise<void> {
    const msg = mapTelegramUpdateToIncoming(update);
    if (!msg) return;

    // AI şeffaflığı (CLAUDE.md §7): tek kaynak ConversationService'tir
    // (kanal-agnostik, her adaptör için geçerli — bkz. D-055). Burada AYRICA
    // gönderilmez: iki bağımsız gönderim aynı /start'ta mükerrer mesaja yol
    // açıyordu (canlıda bulundu, D-055).
    for (const handler of this.handlers) {
      try {
        await handler(msg);
      } catch (err) {
        this.logger.error(`Handler hatası: ${errMsg(err)}`);
      }
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Api, Bot } from 'grammy';
import { AppConfigService } from '../../../config/config.service';
import { IncomingMessage } from '../channel.adapter';
import { aiDisclosureText } from '../messages';
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
        this.running = true;
        this.logger.log(
          'Telegram bot webhook modu için hazır (webhook endpoint bağlama ' +
            'ana uygulamanın/DevOps agent’ının sorumluluğunda).',
        );
      }
    } catch (err) {
      this.running = false;
      this.logger.error(
        `Telegram botu başlatılamadı: ${errMsg(err)} — uygulama yine de ` +
          'çalışmaya devam ediyor.',
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

    // AI şeffaflığı (CLAUDE.md §7): /start akışında kanal seviyesinde garanti
    // edilir — downstream modüllere/UX metnine bırakılmaz.
    if (msg.kind === 'command' && msg.command === 'start') {
      await this.trySendDisclosure(msg.channelUserId, msg.locale);
    }

    for (const handler of this.handlers) {
      try {
        await handler(msg);
      } catch (err) {
        this.logger.error(`Handler hatası: ${errMsg(err)}`);
      }
    }
  }

  private async trySendDisclosure(
    chatId: string,
    locale?: string,
  ): Promise<void> {
    try {
      await this.bot?.api.sendMessage(chatId, aiDisclosureText(locale));
    } catch (err) {
      this.logger.error(`AI şeffaflık mesajı gönderilemedi: ${errMsg(err)}`);
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

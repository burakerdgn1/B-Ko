import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from './env.schema';

/**
 * Doğrulanmış env'e tip-güvenli erişim. Uygulama kodu `process.env`'e
 * doğrudan dokunmaz — tüm sırlar buradan geçer.
 */
@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);

  constructor(private readonly config: ConfigService<AppEnv, true>) {
    this.warnAboutDevFallbacks();
  }

  get<K extends keyof AppEnv>(key: K): AppEnv[K] {
    return this.config.get(key, { infer: true }) as AppEnv[K];
  }

  get nodeEnv(): AppEnv['NODE_ENV'] {
    return this.get('NODE_ENV');
  }
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
  get port(): number {
    return this.get('PORT');
  }

  // ── LLM ──
  get llmMock(): boolean {
    return this.get('LLM_MOCK');
  }
  get anthropicApiKey(): string | undefined {
    return this.get('ANTHROPIC_API_KEY');
  }
  get llmModel(): string {
    return this.get('LLM_MODEL');
  }
  get llmMaxTokens(): number {
    return this.get('LLM_MAX_TOKENS');
  }
  get ocrProvider(): AppEnv['OCR_PROVIDER'] {
    return this.get('OCR_PROVIDER');
  }

  // ── Telegram ──
  get telegramMode(): AppEnv['TELEGRAM_MODE'] {
    return this.get('TELEGRAM_MODE');
  }
  get telegramBotToken(): string | undefined {
    return this.get('TELEGRAM_BOT_TOKEN');
  }
  get telegramWebhookSecret(): string | undefined {
    return this.get('TELEGRAM_WEBHOOK_SECRET');
  }
  /** Bakım script'leri için: bot hiç başlatılmaz (D-043). */
  get telegramSkipStartup(): boolean {
    return this.get('TELEGRAM_SKIP_STARTUP');
  }

  /** Yerel geliştirme/script bağlamı: cron'lar hiç koşmaz (D-047). */
  get schedulerSkipStartup(): boolean {
    return this.get('SCHEDULER_SKIP_STARTUP');
  }

  // ── Persistence ──
  get dbDriver(): AppEnv['DB_DRIVER'] {
    return this.get('DB_DRIVER');
  }
  get supabaseUrl(): string | undefined {
    return this.get('SUPABASE_URL');
  }
  get supabaseServiceRoleKey(): string | undefined {
    return this.get('SUPABASE_SERVICE_ROLE_KEY');
  }
  /** Publishable/anon anahtar — RLS'e tabidir, backend bununla çalışmaz. */
  get supabaseAnonKey(): string | undefined {
    return this.get('SUPABASE_ANON_KEY');
  }

  // ── PII / GDPR ──
  get piiMasterKey(): string | undefined {
    return this.get('PII_MASTER_KEY');
  }
  get dataRetentionDays(): number {
    return this.get('DATA_RETENTION_DAYS');
  }
  get deletionCron(): string {
    return this.get('DELETION_CRON');
  }

  /** Retention politikasına göre silme zamanı (GDPR Art. 17). */
  deleteAfterFrom(now: Date = new Date()): Date {
    return new Date(
      now.getTime() + this.dataRetentionDays * 24 * 60 * 60 * 1000,
    );
  }

  private warnAboutDevFallbacks(): void {
    if (this.isProduction) return;
    if (!this.piiMasterKey) {
      this.logger.warn(
        'PII_MASTER_KEY tanımsız — DEV-ONLY türetilmiş anahtar kullanılıyor. ' +
          'Üretimde ASLA kullanmayın (bkz. MANUAL_ACTIONS_REQUIRED.md §4).',
      );
    }
    if (this.llmMock) {
      this.logger.warn('LLM_MOCK=true — Claude çağrıları mock yanıt döndürüyor.');
    }
    if (this.dbDriver === 'memory') {
      this.logger.warn('DB_DRIVER=memory — veriler kalıcı değil (in-memory).');
    }
  }
}

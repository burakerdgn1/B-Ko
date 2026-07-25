import { Module } from '@nestjs/common';
import { AppConfigModule } from '../../config/config.module';
import { AppConfigService } from '../../config/config.service';
import { PiiModule } from '../../common/pii/pii.module';
import { LlmService } from './llm.service';
import { ANTHROPIC_CLIENT, LazyAnthropicClient } from './anthropic-client';
import {
  ClaudeVisionOcrProvider,
  LocalOcrProvider,
  OCR_PROVIDER_TOKEN,

} from './ocr.provider';

/**
 * LLM entegrasyon modülü — Claude sarmalayıcı (`LlmService`) ve OCR
 * sağlayıcıları burada bir araya getirilir.
 *
 * `OCR_PROVIDER` artık `env.schema.ts` içinde Zod ile doğrulanıyor ve
 * `AppConfigService.ocrProvider` üzerinden okunuyor (ham `process.env` değil) —
 * böylece geçersiz bir değer uygulama başlarken fail-fast yakalanır.
 */
@Module({
  imports: [AppConfigModule, PiiModule],
  providers: [
    LlmService,
    ClaudeVisionOcrProvider,
    LocalOcrProvider,
    {
      provide: ANTHROPIC_CLIENT,
      useFactory: (config: AppConfigService) => new LazyAnthropicClient(config),
      inject: [AppConfigService],
    },
    {
      provide: OCR_PROVIDER_TOKEN,
      useFactory: (
        config: AppConfigService,
        claudeVision: ClaudeVisionOcrProvider,
        local: LocalOcrProvider,
      ) => (config.ocrProvider === 'local' ? local : claudeVision),
      inject: [AppConfigService, ClaudeVisionOcrProvider, LocalOcrProvider],
    },
  ],
  exports: [LlmService],
})
export class LlmModule {}

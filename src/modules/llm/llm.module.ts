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
  resolveOcrProviderKind,
} from './ocr.provider';

/**
 * LLM entegrasyon modülü — Claude sarmalayıcı (`LlmService`) ve OCR
 * sağlayıcıları burada bir araya getirilir.
 *
 * NOT (ana oturuma — bkz. çıktı raporu): `OCR_PROVIDER` ortam değişkeni
 * `src/config/env.schema.ts`'e henüz eklenmedi (o dosya ana oturuma ait, bu
 * modül dokunmuyor). Şimdilik `process.env.OCR_PROVIDER` doğrudan okunuyor
 * (bkz. `resolveOcrProviderKind`); varsayılan `claude-vision`.
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
      useFactory: (claudeVision: ClaudeVisionOcrProvider, local: LocalOcrProvider) =>
        resolveOcrProviderKind() === 'local' ? local : claudeVision,
      inject: [ClaudeVisionOcrProvider, LocalOcrProvider],
    },
  ],
  exports: [LlmService],
})
export class LlmModule {}

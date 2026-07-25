import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { PiiModule } from './common/pii/pii.module';

/**
 * Kök modül.
 *
 * Not: config/crypto/pii @Global — alt modüller ayrıca import etmez.
 * Faz ilerledikçe modüller buraya eklenir (persistence, llm, channels,
 * documents, analysis, drafts, reminders, watcher).
 */
@Module({
  imports: [AppConfigModule, CryptoModule, PiiModule],
})
export class AppModule {}

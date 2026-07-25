import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './config/config.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { PiiModule } from './common/pii/pii.module';
import { PersistenceModule } from './modules/persistence/persistence.module';
import { LlmModule } from './modules/llm/llm.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { DraftsModule } from './modules/drafts/drafts.module';
import { WatcherModule } from './modules/watcher/watcher.module';
import { ConversationModule } from './modules/conversation/conversation.module';

/**
 * Kök modül.
 *
 * Not: config/crypto/pii @Global — alt modüller ayrıca import etmez.
 * PersistenceModule bilinçli olarak @Global DEĞİL; repository'lere ihtiyaç duyan
 * modüller onu açıkça import eder (bağımlılıklar görünür kalsın diye).
 *
 * Faz ilerledikçe eklenecek: documents, analysis, drafts, reminders, watcher.
 */
@Module({
  imports: [
    AppConfigModule,
    // Cron altyapısı: hatırlatma gönderimi ve GDPR (Art.17) silme işleri.
    ScheduleModule.forRoot(),
    CryptoModule,
    PiiModule,
    PersistenceModule,
    LlmModule,
    ChannelsModule,
    AnalysisModule,
    DraftsModule,
    WatcherModule,
    // En son: botu ürün akışına bağlayan orkestrasyon halkası.
    ConversationModule,
  ],
})
export class AppModule {}

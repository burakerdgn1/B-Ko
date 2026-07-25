import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { DraftsModule } from '../drafts/drafts.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { ProfileModule } from '../profile/profile.module';
import { ConversationService } from './conversation.service';

/**
 * Botu ürün akışına bağlayan orkestrasyon modülü.
 * Kanal detaylarını (Telegram/WhatsApp) bilmez — yalnızca `ChannelAdapter`.
 */
@Module({
  imports: [
    ChannelsModule,
    AnalysisModule,
    DraftsModule,
    PersistenceModule,
    ProfileModule,
  ],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}

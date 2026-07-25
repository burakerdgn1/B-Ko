import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { RemindersService } from './reminders.service';
import { RetentionService } from './retention.service';

/**
 * Hatırlatma + GDPR (Art.17) silme modülü (F5.1).
 *
 * ÖNEMLİ (ana oturum için aksiyon): bu modül KASITLI OLARAK
 * `ScheduleModule.forRoot()` İÇERMİYOR — `@nestjs/schedule`'ın `@Cron`
 * dekoratörleri (`RemindersService.handleDueReminders`,
 * `RetentionService.handlePurgeCron`) yalnızca metadata ekler; bu
 * metadata'nın gerçekten periyodik çalıştırılması için `ScheduleModule.forRoot()`
 * KÖK modülde (`AppModule`) bir kez eklenmelidir (bkz. bu modülün rapor
 * çıktısı — "Ana oturumun yapması gerekenler").
 */
@Module({
  imports: [PersistenceModule, ChannelsModule],
  providers: [RemindersService, RetentionService],
  exports: [RemindersService, RetentionService],
})
export class RemindersModule {}

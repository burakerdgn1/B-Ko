import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { RemindersService } from './reminders.service';
import { RetentionService } from './retention.service';

/**
 * Hatırlatma + GDPR (Art.17) silme modülü (F5.1).
 *
 * ÖNEMLİ: bu modül KASITLI OLARAK `ScheduleModule.forRoot()` İÇERMİYOR —
 * `SchedulerRegistry`'nin (global) sağlanması ve `@nestjs/schedule`'ın
 * `@Cron` dekoratörlerinin (`RemindersService.handleDueReminders`) işlenmesi
 * için `ScheduleModule.forRoot()` KÖK modülde (`AppModule`) bir kez
 * eklenmelidir — bu zaten yapılmış durumda (`app.module.ts`).
 *
 * `RetentionService.handlePurgeCron` ARTIK `@Cron` dekoratörü KULLANMIYOR
 * (D-051): `DELETION_CRON` runtime'da okunabilsin diye cron, servisin
 * `onModuleInit()`'inde `SchedulerRegistry.addCronJob()` ile DİNAMİK olarak
 * kaydediliyor — bunun için de yukarıdaki global `SchedulerRegistry`
 * provider'ı (yani `ScheduleModule.forRoot()`) gereklidir.
 */
@Module({
  imports: [PersistenceModule, ChannelsModule],
  providers: [RemindersService, RetentionService],
  exports: [RemindersService, RetentionService],
})
export class RemindersModule {}

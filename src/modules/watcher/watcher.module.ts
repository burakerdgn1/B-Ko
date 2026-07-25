import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { ChannelsModule } from '../channels/channels.module';
import { AppointmentChecker } from './appointment-checker';
import { WatcherService } from './watcher.service';

/**
 * Ausländerbehörde randevu izleme modülü — Playwright PoC (CLAUDE.md §5/§6).
 *
 * `PersistenceModule`: `AppointmentWatchRepository` + `UserRepository`
 * (bildirim için kanal-içi kimliği çözmek üzere, bkz. WatcherService).
 * `ChannelsModule`: `ChannelAdapter` (randevu bulununca kullanıcıyı
 * bilgilendirmek için).
 */
@Module({
  imports: [PersistenceModule, ChannelsModule],
  providers: [AppointmentChecker, WatcherService],
  exports: [WatcherService, AppointmentChecker],
})
export class WatcherModule {}

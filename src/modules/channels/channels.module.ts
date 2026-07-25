import { Module } from '@nestjs/common';
import { ChannelAdapter } from './channel.adapter';
import { MockChannelAdapter } from './mock/mock.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { TelegramService } from './telegram/telegram.service';

/**
 * Kanal-agnostik mesajlaşma katmanı (ARCHITECTURE.md §7, D-002).
 *
 * `ChannelAdapter` DI token'ı burada `TelegramAdapter`'a bağlanır — Telegram
 * v1'in "gerçek" kanalıdır. WhatsApp gerçek kimlik bilgisi gelene kadar
 * `MockChannelAdapter` kullanılır; gerçek anahtar geldiğinde WhatsApp için
 * yeni bir adapter eklenip burada tek satır değiştirilir (provider'ı
 * environment'a göre seçmek istenirse `useFactory` ile genişletilebilir).
 *
 * `MockChannelAdapter` ayrıca kendi sınıf adıyla da export edilir ki testler
 * (bu modül dışındaki agent'lar dâhil) `sentMessages`/`approvalRequests`
 * gibi mock-özel alanlara erişebilsin.
 */
@Module({
  providers: [
    TelegramService,
    TelegramAdapter,
    MockChannelAdapter,
    { provide: ChannelAdapter, useExisting: TelegramAdapter },
  ],
  exports: [ChannelAdapter, MockChannelAdapter, TelegramService, TelegramAdapter],
})
export class ChannelsModule {}

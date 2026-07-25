import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfigService } from '../../config/config.service';
import { ChannelAdapter } from '../channels/channel.adapter';
import { AppointmentWatch } from '../../common/types/domain';
import { AppointmentWatchRepository } from '../persistence/repositories/appointment-watch.repository';
import { UserRepository } from '../persistence/repositories/user.repository';
import { AppointmentChecker } from './appointment-checker';

/**
 * Ausländerbehörde randevu izleme servisi — Playwright PoC orkestrasyonu
 * (CLAUDE.md §5/§6, tek kurum/şehir ile sınırlı).
 *
 * KİBAR POLLING (kasıtlı, etik gereklilik): kurum sunucularına orantısız yük
 * bindirmemek için varsayılan tarama aralığı 30 DAKİKA'dır
 * (`CronExpression.EVERY_30_MINUTES`). Bu bir performans kısıtı değil, etik
 * bir tasarım kararıdır — saniye/dakika mertebesinde agresif polling burada
 * KASITLI OLARAK desteklenmez. `checkNow()` yalnızca kullanıcı/operatör
 * açıkça talep ettiğinde (manuel tetik) devreye girer.
 *
 * Durum makinesi (`WatchStatus`):
 *   active  → (randevu bulunana kadar) periyodik kontrol edilir
 *   found   → randevu bulundu, kullanıcı bilgilendirildi, artık taranmaz
 *   paused  → kullanıcı/operatör durdurdu, taranmaz
 *   error   → son kontrolde hata oluştu; DİĞER izlemeleri ETKİLEMEZ, bir
 *             sonraki cron turunda yeniden denenir (kalıcı olarak devre dışı
 *             bırakılmaz — geçici ağ/sunucu sorunları kendini düzeltebilir).
 */
@Injectable()
export class WatcherService {
  private readonly logger = new Logger(WatcherService.name);

  constructor(
    private readonly watches: AppointmentWatchRepository,
    private readonly checker: AppointmentChecker,
    private readonly channel: ChannelAdapter,
    private readonly users: UserRepository,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Yeni bir izleme kaydı oluşturur (`status: 'active'`).
   *
   * URL, çağıran taraf (kullanıcı/Telegram akışı) tarafından açıkça verilir —
   * bu servis hiçbir kurum sitesini kendiliğinden keşfetmez/taramaz.
   */
  async createWatch(
    userId: string,
    authorityKey: string,
    targetUrl: string,
    serviceLabel?: string,
  ): Promise<AppointmentWatch> {
    return this.watches.create({
      userId,
      authorityKey,
      targetUrl,
      serviceLabel: serviceLabel ?? null,
      status: 'active',
      lastCheckedAt: null,
      lastResult: {},
      foundAt: null,
      checkCount: 0,
      errorMessage: null,
      deleteAfter: this.config.deleteAfterFrom(),
    });
  }

  async pauseWatch(id: string): Promise<AppointmentWatch> {
    return this.watches.update(id, { status: 'paused' });
  }

  /** Operatör/kullanıcı talebiyle tek bir izlemeyi HEMEN kontrol eder. */
  async checkNow(id: string): Promise<AppointmentWatch> {
    const watch = await this.watches.findById(id);
    if (!watch) {
      throw new Error(`AppointmentWatch bulunamadı: ${id}`);
    }
    return this.performCheck(watch);
  }

  /**
   * Periyodik tarama — varsayılan olarak 30 dakikada bir.
   *
   * Her aktif izleme BAĞIMSIZ try/catch içinde kontrol edilir: birindeki
   * hata (ör. sayfa yapısı değişmiş, tarayıcı kurulu değil) diğerlerinin
   * taranmasını ENGELLEMEZ (görev tanımı, F3b).
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkActiveWatches(): Promise<void> {
    const active = await this.watches.findActive();
    if (active.length === 0) return;

    this.logger.log(`${active.length} aktif randevu izlemesi kontrol ediliyor.`);

    for (const watch of active) {
      try {
        await this.performCheck(watch);
      } catch (error) {
        // performCheck kendi hatasını zaten `status: 'error'` olarak
        // kaydeder; burada yalnızca döngünün devam ettiğinden emin oluyoruz.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `İzleme kontrolü sırasında beklenmeyen hata (watchId=${watch.id}): ${message}`,
        );
      }
    }
  }

  /**
   * Tek bir izlemeyi kontrol eder, kaydı günceller ve randevu bulunduysa
   * kullanıcıya bildirim gönderir. Hem cron döngüsü hem `checkNow` bunu
   * kullanır (tek doğruluk kaynağı).
   */
  private async performCheck(watch: AppointmentWatch): Promise<AppointmentWatch> {
    const checkedAt = new Date();

    try {
      const result = await this.checker.check(watch.targetUrl);

      const updated = await this.watches.update(watch.id, {
        lastCheckedAt: checkedAt,
        lastResult: { available: result.available, slots: result.slots },
        checkCount: watch.checkCount + 1,
        errorMessage: null,
        ...(result.available
          ? { status: 'found' as const, foundAt: checkedAt }
          : {}),
      });

      if (result.available) {
        // Bildirim en KRİTİK olmayan adımdır: kayıt zaten `found` olarak
        // kalıcılaştırıldı. Bildirim gönderimi başarısız olursa (ör. kanal
        // hatası) bu, izleme durumunu 'error'a ÇEVİRMEMELİ — randevu bulundu
        // bilgisi asıl değerli olan, bildirim yalnızca bir kolaylık katmanı.
        await this.notifyFound(updated, result.slots).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Randevu bulundu bildirimi gönderilemedi (watchId=${watch.id}): ${message}`,
          );
        });
      }

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Randevu kontrolü başarısız (watchId=${watch.id}, url=${watch.targetUrl}): ${message}`,
      );

      return this.watches.update(watch.id, {
        status: 'error',
        lastCheckedAt: checkedAt,
        checkCount: watch.checkCount + 1,
        errorMessage: message,
      });
    }
  }

  private async notifyFound(
    watch: AppointmentWatch,
    slots: string[],
  ): Promise<void> {
    // AppointmentWatch.userId, dahili User.id'dir (channel-agnostik) —
    // ChannelAdapter.sendMessage ise kanal-içi kimliği (ör. Telegram chat id)
    // bekler. Bu yüzden önce User kaydı üzerinden `channelUserId` çözülür
    // (ARCHITECTURE.md §7, kanal-agnostiklik).
    const user = await this.users.findById(watch.userId);
    if (!user) {
      this.logger.warn(
        `Bildirim gönderilemedi: userId=${watch.userId} için kullanıcı kaydı bulunamadı.`,
      );
      return;
    }

    const label = watch.serviceLabel ?? watch.authorityKey;
    const slotList = slots.slice(0, 5).map((s) => `• ${s}`).join('\n');

    const text =
      `Randevu bulundu: ${label}\n\n${slotList}\n\n` +
      'Bu bir otomatik bildirimdir (yapay zeka botu); randevuyu almak için ' +
      'ilgili kurum sitesini kendiniz ziyaret etmeniz gerekir — bu bot ' +
      'sizin adınıza otomatik randevu almaz.';

    await this.channel.sendMessage(user.channelUserId, text);
  }
}

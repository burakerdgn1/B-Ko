import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Reminder } from '../../common/types/domain';
import { AppConfigService } from '../../config/config.service';
import { PiiService } from '../../common/pii/pii.service';
import { PiiVaultService } from '../../common/pii/pii-vault.service';
import { ChannelAdapter } from '../channels/channel.adapter';
import { AnalysisRepository } from '../persistence/repositories/analysis.repository';
import { PiiVaultRepository } from '../persistence/repositories/pii-vault.repository';
import { ReminderRepository } from '../persistence/repositories/reminder.repository';
import { UserRepository } from '../persistence/repositories/user.repository';
import { buildReminderMessage } from './reminders.messages';

/**
 * Deadline hatırlatma cron'u (F5.1, ARCHITECTURE.md §3).
 *
 * Akış:
 *   1. `ReminderRepository.findDue(now)` ile vadesi gelen (`status: 'scheduled'`,
 *      `dueDate <= now`) hatırlatmaları al.
 *   2. Her biri için: kullanıcıyı bul → varsa analizi bul → analiz alanları
 *      MASKELİ olduğundan `pii_vault`'tan haritayı kurup UNMASK et → mesajı
 *      gönderim ANINDA üret → kanal üzerinden gönder → `sent` işaretle.
 *   3. Bir kullanıcı için gönderim hatası TÜM cron'u çökertmemeli — her
 *      hatırlatma kendi try/catch bloğunda işlenir, hata loglanır, diğerleri
 *      etkilenmeden devam eder.
 *
 * Not (ana oturum için): bu sınıf yalnızca `@Cron` dekoratörü kullanır.
 * `@nestjs/schedule`'ın `ScheduleModule.forRoot()` çağrısı KÖK modülde
 * (`AppModule`) eklenmelidir — aksi hâlde dekoratör metadata'sı hiçbir zaman
 * işlenmez ve cron gerçekte çalışmaz (bkz. bu modülün raporu).
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly reminders: ReminderRepository,
    private readonly users: UserRepository,
    private readonly analyses: AnalysisRepository,
    private readonly piiVaultRepo: PiiVaultRepository,
    private readonly piiVault: PiiVaultService,
    private readonly pii: PiiService,
    private readonly channel: ChannelAdapter,
    private readonly config: AppConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'reminders-due' })
  async handleDueReminders(): Promise<void> {
    // D-047: EN BAŞTA — herhangi bir DB okuması/yazmasından ÖNCE.
    // Sonra sınansaydı `findDue()` zaten üretim veritabanına gitmiş olurdu.
    if (this.config.schedulerSkipStartup) {
      this.logger.warn(
        'SCHEDULER_SKIP_STARTUP=true — vadesi gelen hatırlatmalar İŞLENMEDİ. ' +
          'Yerel/script bağlamında üretim verisine ikinci bir zamanlayıcı ' +
          'çalıştırmamak için (D-047).',
      );
      return;
    }

    const now = new Date();
    const due = await this.reminders.findDue(now);

    if (due.length === 0) return;
    this.logger.log(`${due.length} adet vadesi gelen hatırlatma bulundu.`);

    for (const reminder of due) {
      try {
        await this.sendReminder(reminder, now);
      } catch (error) {
        // KRİTİK: bir kullanıcının hatası diğerlerinin hatırlatmasını
        // engellememeli — logla, döngüye devam et.
        this.logger.error(
          `Hatırlatma gönderilemedi (reminderId=${reminder.id}, ` +
            `userId=${reminder.userId}): ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Tek bir hatırlatmayı işler: kullanıcı/analiz bilgisini toplar, PII'yi
   * yerelde unmask eder, mesajı üretir, gönderir ve durumu günceller.
   *
   * Ham PII ASLA DB'ye geri yazılmaz — unmask edilmiş metin yalnızca gönderim
   * için bellekte oluşturulur, `reminders.message` alanına kalıcı yazılmaz.
   */
  private async sendReminder(reminder: Reminder, now: Date): Promise<void> {
    const user = await this.users.findById(reminder.userId);
    if (!user) {
      throw new Error(`Hatırlatma için kullanıcı bulunamadı: ${reminder.userId}`);
    }

    const analysis = reminder.analysisId
      ? await this.analyses.findById(reminder.analysisId)
      : null;

    let authority = analysis?.authority ?? null;
    let requestType = analysis?.requestType ?? null;

    if (analysis) {
      // Analiz alanları MASKELİ kalıcılaştırılmıştı (analysis.pipeline.ts) —
      // gönderim anında pii_vault'tan harita kurup unmask ediyoruz.
      const sealed = await this.piiVaultRepo.findByDocument(analysis.documentId);
      const map = this.piiVault.open(sealed, {
        userId: user.id,
        documentId: analysis.documentId,
      });
      authority = authority ? this.pii.unmask(authority, map) : null;
      requestType = requestType ? this.pii.unmask(requestType, map) : null;
    }

    const text = buildReminderMessage({
      authority,
      requestType,
      // deadlineDate zaten gerçek (unmask edilmiş) bir tarihtir — bkz.
      // AnalysisPipeline.resolveDeadline (D-009).
      deadline: analysis?.deadlineDate ?? null,
      locale: user.locale,
      now,
    });

    await this.channel.sendMessage(user.channelUserId, text);

    await this.reminders.update(reminder.id, { status: 'sent', sentAt: now });
  }
}

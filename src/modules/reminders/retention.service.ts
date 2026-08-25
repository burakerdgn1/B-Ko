import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfigService } from '../../config/config.service';
import { AnalysisRepository } from '../persistence/repositories/analysis.repository';
import { DocumentRepository } from '../persistence/repositories/document.repository';
import { DraftRepository } from '../persistence/repositories/draft.repository';
import { PiiVaultRepository } from '../persistence/repositories/pii-vault.repository';
import { ReminderRepository } from '../persistence/repositories/reminder.repository';
import { UserRepository } from '../persistence/repositories/user.repository';
import { AuditRepository } from '../persistence/repositories/audit.repository';

/**
 * `AppConfigService.deletionCron`'un varsayılan değeri (`env.schema.ts` ile
 * BİREBİR aynı tutulmalı) — yalnızca dokümantasyon/log mesajı amaçlı.
 *
 * DÜZELTME (D-051): Önceden bu değer statik bir `@Cron(...)` dekoratörüne
 * geçiriliyordu. Dekoratörün argümanı sınıf gövdesi değerlendirilirken (DI
 * enjeksiyonundan ÖNCE) sabitlenmek ZORUNDA olduğundan, `.env`'den farklı bir
 * `DELETION_CRON` verilse bile gerçek zamanlama hiçbir zaman değişmiyordu —
 * yalnızca bir uyarı loglanıyordu. Artık `@Cron` KULLANILMIYOR: gerçek cron,
 * `onModuleInit()` içinde `SchedulerRegistry.addCronJob()` ile config'ten
 * okunan GERÇEK `DELETION_CRON` değeriyle runtime'da kaydediliyor — NestJS'in
 * resmi "Dynamic schedule module" deseni. `cron` paketi `package.json`'da
 * doğrudan bağımlılık olarak listeli değil ama `@nestjs/schedule@^4.1.1`'in
 * geçişli bağımlılığı olarak zaten `node_modules/cron`'da kurulu (v3.2.1,
 * tipleriyle birlikte) — ek `npm install` gerekmedi.
 */
export const DEFAULT_DELETION_CRON = '0 3 * * *';

/** `SchedulerRegistry`'de kayıtlı GDPR silme cron job'ının adı. */
export const GDPR_PURGE_CRON_JOB_NAME = 'gdpr-purge';

/** `purgeNow`/`deleteUserData` tarafından döndürülen, tabloya göre silinen adet. */
export type PurgeCounts = Record<
  'piiVault' | 'drafts' | 'analyses' | 'reminders' | 'documents' | 'users',
  number
>;

/**
 * GDPR Art. 17 — veri minimizasyonu/silme servisi (F5.1, CLAUDE.md §7).
 *
 * İki tetikleme yolu:
 *   1. Otomatik: `onModuleInit()`'te `SchedulerRegistry` ile RUNTIME'DA
 *      kaydedilen, `DELETION_CRON`'a göre periyodik `purgeNow()` çağrısı
 *      (süresi geçmiş TÜM kayıtlar).
 *   2. Elle: `purgeNow()` (aynı mantık, endpoint/test için) ve `deleteUserData()`
 *      (tek bir kullanıcının TÜM verisi — kullanıcının "verimi sil" talebi).
 *
 * Silme sırası `supabase/migrations/0001_init.sql`'deki `purge_expired_data()`
 * fonksiyonuyla BİREBİR aynıdır (referans bütünlüğü — önce en bağımlı tablo):
 * pii_vault → drafts → analyses → reminders → documents → users.
 */
@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly users: UserRepository,
    private readonly documents: DocumentRepository,
    private readonly analyses: AnalysisRepository,
    private readonly drafts: DraftRepository,
    private readonly reminders: ReminderRepository,
    private readonly piiVault: PiiVaultRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * GDPR silme cron'unu RUNTIME'DA, config'ten okunan gerçek `DELETION_CRON`
   * değeriyle kaydeder (bkz. `DEFAULT_DELETION_CRON` üstündeki DÜZELTME notu).
   * `SchedulerRegistry.addCronJob`, döndürdüğü `CronJob`'ın `fireOnTick`'ini
   * otomatik olarak try/catch'e sarar (bkz. `@nestjs/schedule` kaynağı) — bu
   * yüzden burada ayrıca bir hata yakalama sarmalayıcısına gerek yok.
   */
  onModuleInit(): void {
    const cronTime = this.config.deletionCron;
    const job = new CronJob(cronTime, () => this.handlePurgeCron());

    this.schedulerRegistry.addCronJob(GDPR_PURGE_CRON_JOB_NAME, job);
    job.start();

    this.logger.log(
      cronTime === DEFAULT_DELETION_CRON
        ? `GDPR silme cron'u ('${GDPR_PURGE_CRON_JOB_NAME}') varsayılan ` +
            `zamanlamayla kaydedildi: '${cronTime}'.`
        : `GDPR silme cron'u ('${GDPR_PURGE_CRON_JOB_NAME}') DELETION_CRON ` +
            `override'ı ile kaydedildi: '${cronTime}' (varsayılan ` +
            `'${DEFAULT_DELETION_CRON}'dan farklı).`,
    );
  }

  async handlePurgeCron(): Promise<void> {
    // D-047: EN BAŞTA — `purgeNow()` SİLME yapar, sonradan sınamak geç olurdu.
    // Guard yalnızca CRON yolunu kapatır; `purgeNow()` elle çağrıldığında
    // (endpoint/test) çalışmaya devam eder — bilinçli: orada niyet açıktır.
    if (this.config.schedulerSkipStartup) {
      this.logger.warn(
        'SCHEDULER_SKIP_STARTUP=true — otomatik GDPR silmesi ÇALIŞMADI ' +
          '(yerel/script bağlamı, D-047).',
      );
      return;
    }
    await this.purgeNow();
  }

  /**
   * Süresi geçmiş (`deleteAfter < now`) TÜM kayıtları siler.
   * Elle tetiklenebilir (endpoint/test) — cron da bunu çağırır.
   */
  async purgeNow(): Promise<PurgeCounts> {
    const now = new Date();

    // Sıra KRİTİK — referans bütünlüğü (bkz. sınıf üstü not).
    const counts: PurgeCounts = {
      piiVault: await this.piiVault.purgeExpired(now),
      drafts: await this.drafts.purgeExpired(now),
      analyses: await this.analyses.purgeExpired(now),
      reminders: await this.reminders.purgeExpired(now),
      documents: await this.documents.purgeExpired(now),
      users: await this.users.purgeExpired(now),
    };

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    this.logger.log(`GDPR Art.17 otomatik silme tamamlandı: ${JSON.stringify(counts)}`);

    // Denetim izi — YALNIZCA sayılar, asla veri (CLAUDE.md §7).
    await this.audit.append({
      userId: null,
      action: 'gdpr.purge',
      entityType: null,
      entityId: null,
      detail: { ...counts, total },
    });

    return counts;
  }

  /**
   * Bir kullanıcının "verimi sil" (GDPR Art.17) talebi — o kullanıcıya ait
   * HER ŞEYİ siler. Cascade sırası `purgeNow`/`purge_expired_data()` ile aynı.
   *
   * BİLİNEN KISITLAMA: `ReminderRepository` kullanıcı-bazlı bir sorgu
   * Hatırlatmalar `ReminderRepository.findByUser` ile DURUMDAN BAĞIMSIZ
   * olarak silinir. (Önceki sürüm `findDue` ile tarıyordu; bu yalnızca
   * `scheduled` kayıtları kapsadığı için `sent`/`cancelled` hatırlatmalar
   * geride kalıyordu — silme talebinin eksik kalması kabul edilemez.)
   */
  async deleteUserData(userId: string): Promise<void> {
    const documents = await this.documents.findByUser(userId);

    // ── 1. pii_vault (kullanıcı-bazlı + belge-bazlı) ──
    const userScopedVault = await this.piiVault.findByUser(userId);
    let piiVaultDeleted = userScopedVault.length;
    for (const row of userScopedVault) {
      await this.piiVault.delete(row.id);
    }
    for (const doc of documents) {
      const docVault = await this.piiVault.findByDocument(doc.id);
      piiVaultDeleted += docVault.length;
      await this.piiVault.deleteByDocument(doc.id);
    }

    // ── 2-3. drafts → analyses (belge bazlı) ──
    let draftsDeleted = 0;
    let analysesDeleted = 0;
    for (const doc of documents) {
      const analyses = await this.analyses.findByDocument(doc.id);
      for (const analysis of analyses) {
        const analysisDrafts = await this.drafts.findByAnalysis(analysis.id);
        for (const draft of analysisDrafts) {
          await this.drafts.delete(draft.id);
          draftsDeleted++;
        }
        await this.analyses.delete(analysis.id);
        analysesDeleted++;
      }
    }

    // ── 4. reminders (bkz. sınıf üstü KISITLAMA notu) ──
    const userReminders = await this.reminders.findByUser(userId);
    let remindersDeleted = 0;
    for (const reminder of userReminders) {
      await this.reminders.delete(reminder.id);
      remindersDeleted++;
    }

    // ── 5. documents ──
    for (const doc of documents) {
      await this.documents.delete(doc.id);
    }

    // ── 6. audit + user (kullanıcıyı silmeden HEMEN önce logla — userId hâlâ geçerli) ──
    await this.audit.append({
      userId,
      action: 'gdpr.delete_user',
      entityType: 'user',
      entityId: userId,
      detail: {
        piiVault: piiVaultDeleted,
        drafts: draftsDeleted,
        analyses: analysesDeleted,
        reminders: remindersDeleted,
        documents: documents.length,
      },
    });

    await this.users.delete(userId);

    this.logger.log(`GDPR Art.17 kullanıcı silme talebi tamamlandı (userId=${userId}).`);
  }
}

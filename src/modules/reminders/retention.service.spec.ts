import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../app.module';
import type { AppConfigService } from '../../config/config.service';
import { PiiEntityType } from '../../common/pii/pii.types';
import { SealedPiiRecord } from '../../common/pii/pii-vault.service';
import { AnalysisRepository } from '../persistence/repositories/analysis.repository';
import { AuditRepository } from '../persistence/repositories/audit.repository';
import { DocumentRepository } from '../persistence/repositories/document.repository';
import { DraftRepository } from '../persistence/repositories/draft.repository';
import { PiiVaultRepository } from '../persistence/repositories/pii-vault.repository';
import { ReminderRepository } from '../persistence/repositories/reminder.repository';
import { UserRepository } from '../persistence/repositories/user.repository';
import { RemindersModule } from './reminders.module';
import { DEFAULT_DELETION_CRON, GDPR_PURGE_CRON_JOB_NAME, RetentionService } from './retention.service';

/**
 * `RetentionService` (GDPR Art.17) testleri — gerçek in-memory persistence,
 * gerçek zamanlayıcı BEKLENMEZ (`purgeNow`/`deleteUserData` doğrudan çağrılır).
 */
describe('RetentionService', () => {
  let app: INestApplication;
  let service: RetentionService;
  let users: UserRepository;
  let documents: DocumentRepository;
  let analyses: AnalysisRepository;
  let drafts: DraftRepository;
  let reminders: ReminderRepository;
  let piiVault: PiiVaultRepository;
  let audit: AuditRepository;

  const ORIGINAL_ENV = process.env;
  const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      LLM_MOCK: 'true',
      DB_DRIVER: 'memory',
      TELEGRAM_MODE: 'disabled',
    };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PII_MASTER_KEY;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, RemindersModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    service = app.get(RetentionService);
    users = app.get(UserRepository);
    documents = app.get(DocumentRepository);
    analyses = app.get(AnalysisRepository);
    drafts = app.get(DraftRepository);
    reminders = app.get(ReminderRepository);
    piiVault = app.get(PiiVaultRepository);
    audit = app.get(AuditRepository);
  });

  afterEach(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  function dummySealedRecord(scope: {
    userId?: string;
    documentId?: string;
    deleteAfter?: Date;
  }): SealedPiiRecord {
    return {
      token: `[[NAME_${randomUUID().slice(0, 4)}]]`,
      entityType: PiiEntityType.NAME,
      ciphertext: 'dGVzdA==',
      iv: 'aXY=',
      authTag: 'dGFn',
      keyVersion: 1,
      ...scope,
    };
  }

  describe('purgeNow', () => {
    it('yalnızca deleteAfter geçmiş kayıtları siler, geçmemişlere dokunmaz', async () => {
      const userExpired = await users.create({
        channel: 'telegram',
        channelUserId: `exp-${randomUUID()}`,
        locale: 'de',
        deleteAfter: PAST,
      });
      const userFresh = await users.create({
        channel: 'telegram',
        channelUserId: `fresh-${randomUUID()}`,
        locale: 'de',
        deleteAfter: FUTURE,
      });

      const docExpired = await documents.create({
        userId: userFresh.id,
        source: 'text',
        status: 'analyzed',
        maskedText: null,
        deleteAfter: PAST,
      });
      const docFresh = await documents.create({
        userId: userFresh.id,
        source: 'text',
        status: 'analyzed',
        maskedText: null,
        deleteAfter: FUTURE,
      });

      const analysisExpired = await analyses.create({
        documentId: docExpired.id,
        authority: null,
        requestType: null,
        summary: 'maskeli',
        deadlineDate: null,
        riskLevel: 'low',
        missingDocuments: [],
        nextSteps: [],
        deleteAfter: PAST,
      });
      const analysisFresh = await analyses.create({
        documentId: docFresh.id,
        authority: null,
        requestType: null,
        summary: 'maskeli',
        deadlineDate: null,
        riskLevel: 'low',
        missingDocuments: [],
        nextSteps: [],
        deleteAfter: FUTURE,
      });

      const draftExpired = await drafts.create({
        analysisId: analysisExpired.id,
        content: 'taslak',
        subject: null,
        language: 'de',
        status: 'draft',
        approvedAt: null,
        rejectedAt: null,
        sentAt: null,
        rejectReason: null,
        deleteAfter: PAST,
      });
      const draftFresh = await drafts.create({
        analysisId: analysisFresh.id,
        content: 'taslak',
        subject: null,
        language: 'de',
        status: 'draft',
        approvedAt: null,
        rejectedAt: null,
        sentAt: null,
        rejectReason: null,
        deleteAfter: FUTURE,
      });

      const reminderExpired = await reminders.create({
        userId: userFresh.id,
        analysisId: analysisFresh.id,
        kind: 'deadline',
        dueDate: new Date(),
        message: null,
        status: 'scheduled',
        sentAt: null,
        deleteAfter: PAST,
      });
      const reminderFresh = await reminders.create({
        userId: userFresh.id,
        analysisId: analysisFresh.id,
        kind: 'deadline',
        dueDate: new Date(),
        message: null,
        status: 'scheduled',
        sentAt: null,
        deleteAfter: FUTURE,
      });

      const vaultExpiredRow = await piiVault.create(
        dummySealedRecord({ userId: userFresh.id, deleteAfter: PAST }),
      );
      const vaultFreshRow = await piiVault.create(
        dummySealedRecord({ userId: userFresh.id, deleteAfter: FUTURE }),
      );

      const counts = await service.purgeNow();

      expect(counts.users).toBe(1);
      expect(counts.documents).toBe(1);
      expect(counts.analyses).toBe(1);
      expect(counts.drafts).toBe(1);
      expect(counts.reminders).toBe(1);
      expect(counts.piiVault).toBe(1);

      expect(await users.findById(userExpired.id)).toBeNull();
      expect(await users.findById(userFresh.id)).not.toBeNull();

      expect(await documents.findById(docExpired.id)).toBeNull();
      expect(await documents.findById(docFresh.id)).not.toBeNull();

      expect(await analyses.findById(analysisExpired.id)).toBeNull();
      expect(await analyses.findById(analysisFresh.id)).not.toBeNull();

      expect(await drafts.findById(draftExpired.id)).toBeNull();
      expect(await drafts.findById(draftFresh.id)).not.toBeNull();

      expect(await reminders.findById(reminderExpired.id)).toBeNull();
      expect(await reminders.findById(reminderFresh.id)).not.toBeNull();

      expect(await piiVault.findById(vaultExpiredRow.id)).toBeNull();
      expect(await piiVault.findById(vaultFreshRow.id)).not.toBeNull();
    });

    it('silinen sayıları gdpr.purge audit girdisi olarak (yalnızca sayı) kaydeder', async () => {
      const counts = await service.purgeNow();

      // `gdpr.purge` girdileri userId:null ile yazılır; memory repository
      // `findByUser` filtrelemesi `===` kullandığından `null` ile de sorgulanabilir.
      const entries = await audit.findByUser(null as unknown as string);
      const purgeEntry = entries.find((e) => e.action === 'gdpr.purge');

      expect(purgeEntry).toBeDefined();
      expect(purgeEntry?.detail).toMatchObject(counts);
      // Denetim izinde ASLA veri olmamalı — yalnızca sayısal alanlar.
      expect(
        Object.values(purgeEntry?.detail ?? {}).every((v) => typeof v === 'number'),
      ).toBe(true);
    });

    it('silme sırası referans hatası üretmez (iç içe bağımlı kayıtlarla)', async () => {
      const user = await users.create({
        channel: 'telegram',
        channelUserId: `chain-${randomUUID()}`,
        locale: 'de',
        deleteAfter: PAST,
      });
      const doc = await documents.create({
        userId: user.id,
        source: 'text',
        status: 'analyzed',
        maskedText: null,
        deleteAfter: PAST,
      });
      const analysis = await analyses.create({
        documentId: doc.id,
        authority: null,
        requestType: null,
        summary: 's',
        deadlineDate: null,
        riskLevel: 'low',
        missingDocuments: [],
        nextSteps: [],
        deleteAfter: PAST,
      });
      await drafts.create({
        analysisId: analysis.id,
        content: 'x',
        subject: null,
        language: 'de',
        status: 'draft',
        approvedAt: null,
        rejectedAt: null,
        sentAt: null,
        rejectReason: null,
        deleteAfter: PAST,
      });
      await reminders.create({
        userId: user.id,
        analysisId: analysis.id,
        kind: 'deadline',
        dueDate: new Date(),
        message: null,
        status: 'scheduled',
        sentAt: null,
        deleteAfter: PAST,
      });
      await piiVault.create(
        dummySealedRecord({ userId: user.id, documentId: doc.id, deleteAfter: PAST }),
      );

      await expect(service.purgeNow()).resolves.toBeDefined();
      await expect(service.purgeNow()).resolves.toBeDefined(); // idempotent — ikinci çağrı da patlamaz
    });
  });

  describe('deleteUserData', () => {
    // Regresyon (D-019): silme, hatırlatmanın DURUMUNDAN bağımsız olmalı.
    // Önceki sürüm yalnızca `scheduled` olanları buluyordu; `sent`/`cancelled`
    // hatırlatmalar kullanıcı verisi olarak geride kalıyordu.
    it('sent/cancelled dahil TÜM hatırlatmaları siler (GDPR Art.17)', async () => {
      const user = await users.create({
        channel: 'telegram',
        channelUserId: `r-${randomUUID()}`,
        locale: 'tr',
      });

      const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);
      for (const status of ['scheduled', 'sent', 'cancelled'] as const) {
        await reminders.create({
          userId: user.id,
          analysisId: null,
          kind: 'deadline',
          dueDate: PAST,
          message: null,
          status,
          sentAt: status === 'sent' ? PAST : null,
          deleteAfter: FUTURE,
        });
      }

      expect(await reminders.findByUser(user.id)).toHaveLength(3);

      await service.deleteUserData(user.id);

      expect(await reminders.findByUser(user.id)).toHaveLength(0);
    });

    it('kullanıcıya ait belge/analiz/taslak/vault/hatırlatma kayıtlarını tamamen siler', async () => {
      const userA = await users.create({
        channel: 'telegram',
        channelUserId: `a-${randomUUID()}`,
        locale: 'tr',
      });
      const userB = await users.create({
        channel: 'telegram',
        channelUserId: `b-${randomUUID()}`,
        locale: 'tr',
      });

      const docA = await documents.create({
        userId: userA.id,
        source: 'text',
        status: 'analyzed',
        maskedText: 'maskeli A',
        deleteAfter: FUTURE,
      });
      const docB = await documents.create({
        userId: userB.id,
        source: 'text',
        status: 'analyzed',
        maskedText: 'maskeli B',
        deleteAfter: FUTURE,
      });

      const analysisA = await analyses.create({
        documentId: docA.id,
        authority: 'X',
        requestType: null,
        summary: 's',
        deadlineDate: null,
        riskLevel: 'low',
        missingDocuments: [],
        nextSteps: [],
        deleteAfter: FUTURE,
      });
      const analysisB = await analyses.create({
        documentId: docB.id,
        authority: 'Y',
        requestType: null,
        summary: 's',
        deadlineDate: null,
        riskLevel: 'low',
        missingDocuments: [],
        nextSteps: [],
        deleteAfter: FUTURE,
      });

      const draftA = await drafts.create({
        analysisId: analysisA.id,
        content: 'taslak A',
        subject: null,
        language: 'tr',
        status: 'draft',
        approvedAt: null,
        rejectedAt: null,
        sentAt: null,
        rejectReason: null,
        deleteAfter: FUTURE,
      });
      const draftB = await drafts.create({
        analysisId: analysisB.id,
        content: 'taslak B',
        subject: null,
        language: 'tr',
        status: 'draft',
        approvedAt: null,
        rejectedAt: null,
        sentAt: null,
        rejectReason: null,
        deleteAfter: FUTURE,
      });

      const reminderA = await reminders.create({
        userId: userA.id,
        analysisId: analysisA.id,
        kind: 'deadline',
        dueDate: new Date(),
        message: null,
        status: 'scheduled',
        sentAt: null,
        deleteAfter: FUTURE,
      });
      const reminderB = await reminders.create({
        userId: userB.id,
        analysisId: analysisB.id,
        kind: 'deadline',
        dueDate: new Date(),
        message: null,
        status: 'scheduled',
        sentAt: null,
        deleteAfter: FUTURE,
      });

      // Kullanıcı-bazlı (onboarding) + belge-bazlı vault kayıtları.
      await piiVault.create(dummySealedRecord({ userId: userA.id }));
      await piiVault.create(
        dummySealedRecord({ userId: userA.id, documentId: docA.id }),
      );
      await piiVault.create(dummySealedRecord({ userId: userB.id }));

      await service.deleteUserData(userA.id);

      expect(await users.findById(userA.id)).toBeNull();
      expect(await documents.findById(docA.id)).toBeNull();
      expect(await analyses.findById(analysisA.id)).toBeNull();
      expect(await drafts.findById(draftA.id)).toBeNull();
      expect(await reminders.findById(reminderA.id)).toBeNull();
      expect(await piiVault.findByUser(userA.id)).toHaveLength(0);
      expect(await piiVault.findByDocument(docA.id)).toHaveLength(0);

      // userB'nin verisi dokunulmadan kalmalı.
      expect(await users.findById(userB.id)).not.toBeNull();
      expect(await documents.findById(docB.id)).not.toBeNull();
      expect(await analyses.findById(analysisB.id)).not.toBeNull();
      expect(await drafts.findById(draftB.id)).not.toBeNull();
      expect(await reminders.findById(reminderB.id)).not.toBeNull();
      expect(await piiVault.findByUser(userB.id)).toHaveLength(1);
    });
  });

  /**
   * D-051 regresyonu: `@Cron` dekoratörü derleme-zamanı sabiti kullandığından
   * `DELETION_CRON` override'ı GERÇEK zamanlamayı hiç değiştirmiyordu (yalnızca
   * bir uyarı loglanıyordu). Artık cron, `onModuleInit()` içinde config'ten
   * okunan gerçek değerle `SchedulerRegistry.addCronJob()` ile RUNTIME'DA
   * kaydediliyor — burada bunu hem "gerçekten çağrıldı" (spy) hem de
   * "registry'de kalıcı olarak duruyor" (getCronJob) açısından doğruluyoruz.
   */
  describe('DELETION_CRON dinamik yeniden-zamanlama (SchedulerRegistry, D-051)', () => {
    it('varsayılan DELETION_CRON ile "gdpr-purge" adında ÇALIŞAN bir cron job kaydedilir', () => {
      const schedulerRegistry = app.get(SchedulerRegistry);
      const job = schedulerRegistry.getCronJob(GDPR_PURGE_CRON_JOB_NAME);

      expect(job).toBeDefined();
      expect(job.cronTime.source).toBe(DEFAULT_DELETION_CRON);
      expect(job.running).toBe(true);
    });

    // NOT (bkz. `scheduler-isolation.spec.ts`'teki büyük yorum): `AppModule`
    // bu dosyanın tepesinde statik import edildiği İÇİN `ConfigModule.forRoot()`
    // doğrulaması `process.env`'i O ANDA (test gövdesi çalışmadan ÖNCE) okur —
    // `it()` içinde `process.env.DELETION_CRON` değiştirip yeniden
    // `Test.createTestingModule({ imports: [AppModule, ...] })` çağırmak,
    // AYNI (çoktan doğrulanmış) config'i yeniden kullanır ve ETKİSİZDİR. D-043
    // ve D-047 testlerinin izlediği kanıtlanmış deseni izliyoruz: servisi
    // sahte bir `AppConfigService` ile DOĞRUDAN kurup `onModuleInit()`'i elle
    // çağırıyoruz — `SchedulerRegistry` ise gerçek (yalnızca bir `Map` saran,
    // DI'sız basit bir sınıf), böylece `addCronJob`'ın GERÇEKTEN doğru
    // zamanlamayla çağrıldığını hem spy hem de registry içeriğiyle doğrularız.
    it('DELETION_CRON farklı bir değerle verildiğinde, SchedulerRegistry.addCronJob GERÇEK zamanlamayla çağrılır', () => {
      const customCron = '*/5 * * * *';
      const schedulerRegistry = new SchedulerRegistry();
      const addCronJobSpy = jest.spyOn(schedulerRegistry, 'addCronJob');

      const fakeConfig = {
        deletionCron: customCron,
        schedulerSkipStartup: false,
      } as AppConfigService;

      const retentionService = new RetentionService(
        fakeConfig,
        schedulerRegistry,
        {} as never, {} as never, {} as never, {} as never,
        {} as never, {} as never, {} as never,
      );

      retentionService.onModuleInit();

      // 1. Spy: `addCronJob` GERÇEKTEN özel zamanlamayla çağrıldı mı?
      expect(addCronJobSpy).toHaveBeenCalledWith(
        GDPR_PURGE_CRON_JOB_NAME,
        expect.objectContaining({
          cronTime: expect.objectContaining({ source: customCron }),
        }),
      );

      // 2. Registry: kayıt kalıcı mı, GERÇEKTEN bu değerle mi duruyor ve çalışıyor mu?
      const registeredJob = schedulerRegistry.getCronJob(GDPR_PURGE_CRON_JOB_NAME);
      expect(registeredJob.cronTime.source).toBe(customCron);
      expect(registeredJob.running).toBe(true);

      registeredJob.stop();
    });
  });
});

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../app.module';
import { PiiService } from '../../common/pii/pii.service';
import { PiiVaultService } from '../../common/pii/pii-vault.service';
import { ChannelAdapter } from '../channels/channel.adapter';
import { AnalysisRepository } from '../persistence/repositories/analysis.repository';
import { DocumentRepository } from '../persistence/repositories/document.repository';
import { PiiVaultRepository } from '../persistence/repositories/pii-vault.repository';
import { ReminderRepository } from '../persistence/repositories/reminder.repository';
import { UserRepository } from '../persistence/repositories/user.repository';
import { RemindersModule } from './reminders.module';
import { RemindersService } from './reminders.service';
import { formatDeadlineDate } from './reminders.messages';

/**
 * `RemindersService` testleri — analysis.pipeline.spec.ts ile aynı desen:
 * gerçek in-memory persistence + gerçek PII servisleri, yalnızca kanal
 * gönderimi (`ChannelAdapter.sendMessage`) jest ile gözlemlenir/simüle edilir
 * (TelegramAdapter, TELEGRAM_MODE=disabled iken gerçekten hata fırlatır —
 * bu yüzden gerçek gönderimi test etmek için spy zorunlu).
 */
describe('RemindersService', () => {
  let app: INestApplication;
  let service: RemindersService;
  let users: UserRepository;
  let documents: DocumentRepository;
  let analyses: AnalysisRepository;
  let reminders: ReminderRepository;
  let piiVaultRepo: PiiVaultRepository;
  let pii: PiiService;
  let piiVault: PiiVaultService;
  let channel: ChannelAdapter;

  const ORIGINAL_ENV = process.env;
  const FAR_FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

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

    service = app.get(RemindersService);
    users = app.get(UserRepository);
    documents = app.get(DocumentRepository);
    analyses = app.get(AnalysisRepository);
    reminders = app.get(ReminderRepository);
    piiVaultRepo = app.get(PiiVaultRepository);
    pii = app.get(PiiService);
    piiVault = app.get(PiiVaultService);
    channel = app.get(ChannelAdapter);
  });

  afterEach(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  /** Kullanıcı + belge + analiz + hatırlatma zincirini kurar, oluşan kayıtları döner. */
  async function createScenario(opts: {
    locale?: string;
    dueDate: Date;
    deadlineDate?: Date | null;
    authority?: string | null;
    requestType?: string | null;
    reminderStatus?: 'scheduled' | 'sent' | 'cancelled';
  }) {
    const user = await users.create({
      channel: 'telegram',
      channelUserId: `chat-${randomUUID()}`,
      locale: opts.locale ?? 'tr',
    });

    const document = await documents.create({
      userId: user.id,
      source: 'text',
      status: 'analyzed',
      maskedText: null,
      deleteAfter: FAR_FUTURE,
    });

    const analysis = await analyses.create({
      documentId: document.id,
      authority: opts.authority ?? 'Ausländerbehörde Berlin',
      requestType: opts.requestType ?? null,
      summary: 'maskeli özet',
      deadlineDate: opts.deadlineDate ?? null,
      riskLevel: 'high',
      missingDocuments: [],
      nextSteps: [],
      deleteAfter: FAR_FUTURE,
    });

    const reminder = await reminders.create({
      userId: user.id,
      analysisId: analysis.id,
      kind: 'deadline',
      dueDate: opts.dueDate,
      message: null,
      status: opts.reminderStatus ?? 'scheduled',
      sentAt: null,
      deleteAfter: FAR_FUTURE,
    });

    return { user, document, analysis, reminder };
  }

  it('vadesi gelen hatırlatma gönderilir ve sent işaretlenir; vadesi gelmemiş dokunulmaz', async () => {
    const sendSpy = jest.spyOn(channel, 'sendMessage').mockResolvedValue(undefined);

    const now = new Date();
    const due = await createScenario({
      dueDate: new Date(now.getTime() - 60 * 60 * 1000), // 1 saat önce vadesi geldi
      deadlineDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    });
    const notDue = await createScenario({
      dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000), // yarın
    });

    await service.handleDueReminders();

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(due.user.channelUserId, expect.any(String));

    const updatedDue = await reminders.findById(due.reminder.id);
    expect(updatedDue?.status).toBe('sent');
    expect(updatedDue?.sentAt).toBeInstanceOf(Date);

    const updatedNotDue = await reminders.findById(notDue.reminder.id);
    expect(updatedNotDue?.status).toBe('scheduled');
    expect(updatedNotDue?.sentAt).toBeNull();
  });

  it('bir kullanıcıya gönderim hatası diğer kullanıcıların hatırlatmasını engellemez', async () => {
    const now = new Date();
    const failing = await createScenario({
      dueDate: new Date(now.getTime() - 60 * 60 * 1000),
    });
    const succeeding = await createScenario({
      dueDate: new Date(now.getTime() - 60 * 60 * 1000),
    });

    jest.spyOn(channel, 'sendMessage').mockImplementation(async (channelUserId) => {
      if (channelUserId === failing.user.channelUserId) {
        throw new Error('gönderim hatası (simüle)');
      }
    });

    await expect(service.handleDueReminders()).resolves.toBeUndefined();

    const failedReminder = await reminders.findById(failing.reminder.id);
    expect(failedReminder?.status).toBe('scheduled'); // hata → durum değişmedi

    const okReminder = await reminders.findById(succeeding.reminder.id);
    expect(okReminder?.status).toBe('sent');
  });

  it('hatırlatma metni gerçek son tarihi içerir (unmask çalışıyor) ve token göstermez', async () => {
    const now = new Date();
    const deadline = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

    // Gerçek maskeleme akışını simüle et: requestType maskeli hâliyle
    // persist edilmiş olsun, orijinal PII yalnızca vault'ta şifreli dursun.
    const { maskedText, map } = pii.mask(
      'Herr Ahmet Yılmaz için ek belge talebi',
      { profile: { fullName: 'Ahmet Yılmaz' } },
    );
    expect(maskedText).toMatch(/\[\[NAME_\d+\]\]/);

    const scenario = await createScenario({
      dueDate: new Date(now.getTime() - 60 * 60 * 1000),
      deadlineDate: deadline,
      requestType: maskedText,
    });

    const sealed = piiVault.seal(
      map,
      { userId: scenario.user.id, documentId: scenario.document.id },
      FAR_FUTURE,
    );
    await piiVaultRepo.saveMany(sealed);

    let capturedText = '';
    jest.spyOn(channel, 'sendMessage').mockImplementation(async (_id, text) => {
      capturedText = text;
    });

    await service.handleDueReminders();

    expect(capturedText).toContain(formatDeadlineDate(deadline));
    expect(capturedText).toContain('Ahmet Yılmaz');
    expect(capturedText).not.toMatch(/\[\[[A-Z]+_\d+\]\]/);
    expect(capturedText).toMatch(/hukuki tavsiye vermez/i);
  });
});

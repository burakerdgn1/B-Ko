import { AppointmentWatchMemoryRepository } from '../persistence/memory/appointment-watch.memory.repository';
import { UserMemoryRepository } from '../persistence/memory/user.memory.repository';
import { MockChannelAdapter } from '../channels/mock/mock.adapter';
import { AppConfigService } from '../../config/config.service';
import { AppointmentChecker } from './appointment-checker';
import { WatcherService } from './watcher.service';

/**
 * WatcherService test seti.
 *
 * KRİTİK: Bu dosya Playwright GEREKTİRMEZ — `AppointmentChecker` burada tam
 * olarak mock'lanır (görev talimatı, F3b). Bu testler CI'da tarayıcı kurulu
 * olsun/olmasın HER ZAMAN çalışmalıdır.
 */

function fakeConfig(): AppConfigService {
  return {
    deleteAfterFrom: (now: Date = new Date()) =>
      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  } as unknown as AppConfigService;
}

function fakeChecker(): jest.Mocked<AppointmentChecker> {
  return { check: jest.fn() } as unknown as jest.Mocked<AppointmentChecker>;
}

async function makeUser(users: UserMemoryRepository, channelUserId = 'tg-123') {
  return users.create({
    channel: 'telegram',
    channelUserId,
    locale: 'de',
    visaType: null,
    familyStatus: null,
    city: null,
    consentAt: null,
    aiDisclosureAckAt: null,
    deleteAfter: null,
  });
}

describe('WatcherService', () => {
  let watches: AppointmentWatchMemoryRepository;
  let users: UserMemoryRepository;
  let channel: MockChannelAdapter;
  let checker: jest.Mocked<AppointmentChecker>;
  let service: WatcherService;

  beforeEach(() => {
    watches = new AppointmentWatchMemoryRepository();
    users = new UserMemoryRepository();
    channel = new MockChannelAdapter();
    checker = fakeChecker();
    service = new WatcherService(watches, checker, channel, users, fakeConfig());
  });

  it('createWatch: yeni izleme active durumunda ve checkCount=0 ile oluşturulur', async () => {
    const user = await makeUser(users);
    const watch = await service.createWatch(
      user.id,
      'lea-berlin',
      'file:///mock/termin.html',
      'Aufenthaltstitel Verlängerung',
    );

    expect(watch.status).toBe('active');
    expect(watch.checkCount).toBe(0);
    expect(watch.targetUrl).toBe('file:///mock/termin.html');
    expect(watch.serviceLabel).toBe('Aufenthaltstitel Verlängerung');
  });

  it('pauseWatch: durumu paused yapar', async () => {
    const user = await makeUser(users);
    const watch = await service.createWatch(user.id, 'lea-berlin', 'file:///x.html');

    const paused = await service.pauseWatch(watch.id);

    expect(paused.status).toBe('paused');
  });

  it('randevu bulununca durum found olur, foundAt set edilir ve kullanıcıya bildirim gönderilir', async () => {
    const user = await makeUser(users, 'tg-999');
    const watch = await service.createWatch(
      user.id,
      'lea-berlin',
      'file:///x.html',
      'Aufenthaltstitel',
    );

    checker.check.mockResolvedValue({
      available: true,
      slots: ['03.08.2026 09:00', '05.08.2026 14:40'],
      checkedAt: new Date(),
    });

    const updated = await service.checkNow(watch.id);

    expect(updated.status).toBe('found');
    expect(updated.foundAt).not.toBeNull();
    expect(updated.checkCount).toBe(1);
    expect(channel.sentMessages).toHaveLength(1);
    expect(channel.sentMessages[0].channelUserId).toBe('tg-999');
    expect(channel.sentMessages[0].text).toContain('Aufenthaltstitel');
  });

  it('randevu yoksa durum active kalır ve bildirim gönderilmez', async () => {
    const user = await makeUser(users);
    const watch = await service.createWatch(user.id, 'lea-berlin', 'file:///x.html');

    checker.check.mockResolvedValue({ available: false, slots: [], checkedAt: new Date() });

    const updated = await service.checkNow(watch.id);

    expect(updated.status).toBe('active');
    expect(channel.sentMessages).toHaveLength(0);
  });

  it('checkCount her kontrolde artar', async () => {
    const user = await makeUser(users);
    const watch = await service.createWatch(user.id, 'lea-berlin', 'file:///x.html');
    checker.check.mockResolvedValue({ available: false, slots: [], checkedAt: new Date() });

    await service.checkNow(watch.id);
    const twice = await service.checkNow(watch.id);

    expect(twice.checkCount).toBe(2);
  });

  it('bir izlemedeki hata status=error yapar ve errorMessage set eder, diğer izlemeleri ETKİLEMEZ', async () => {
    const userA = await makeUser(users, 'tg-a');
    const userB = await makeUser(users, 'tg-b');
    const watchA = await service.createWatch(userA.id, 'lea-berlin', 'file:///broken.html');
    const watchB = await service.createWatch(userB.id, 'lea-berlin', 'file:///ok.html');

    checker.check.mockImplementation(async (url: string) => {
      if (url.includes('broken')) throw new Error('Sayfa yüklenemedi');
      return { available: true, slots: ['03.08.2026 09:00'], checkedAt: new Date() };
    });

    await service.checkActiveWatches();

    const refreshedA = await watches.findById(watchA.id);
    const refreshedB = await watches.findById(watchB.id);

    expect(refreshedA?.status).toBe('error');
    expect(refreshedA?.errorMessage).toContain('Sayfa yüklenemedi');
    expect(refreshedA?.checkCount).toBe(1);
    expect(refreshedB?.status).toBe('found');
    expect(channel.sentMessages).toHaveLength(1);
    expect(channel.sentMessages[0].channelUserId).toBe('tg-b');
  });

  it('paused durumundaki izlemeler checkActiveWatches tarafından atlanır', async () => {
    const user = await makeUser(users);
    const watch = await service.createWatch(user.id, 'lea-berlin', 'file:///x.html');
    await service.pauseWatch(watch.id);

    await service.checkActiveWatches();

    expect(checker.check).not.toHaveBeenCalled();
  });

  it('found durumundaki izlemeler bir daha taranmaz (bulununca durur)', async () => {
    const user = await makeUser(users);
    const watch = await service.createWatch(user.id, 'lea-berlin', 'file:///x.html');
    checker.check.mockResolvedValue({ available: true, slots: ['slot'], checkedAt: new Date() });

    await service.checkNow(watch.id); // status → found
    checker.check.mockClear();

    await service.checkActiveWatches();

    expect(checker.check).not.toHaveBeenCalled();
  });

  it('bildirim gönderimi başarısız olsa bile izleme found durumunda kalır', async () => {
    const user = await makeUser(users);
    const watch = await service.createWatch(user.id, 'lea-berlin', 'file:///x.html');
    checker.check.mockResolvedValue({ available: true, slots: ['slot'], checkedAt: new Date() });
    jest.spyOn(channel, 'sendMessage').mockRejectedValue(new Error('kanal hatası'));

    const updated = await service.checkNow(watch.id);

    expect(updated.status).toBe('found');
  });

  it("checkNow: var olmayan bir izleme id'si için hata fırlatır", async () => {
    await expect(service.checkNow('yok-id')).rejects.toThrow();
  });
});

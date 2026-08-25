import { Logger } from '@nestjs/common';
import { AppConfigService } from '../../../config/config.service';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Bot kimliğinin açılışta GÖRÜNÜR olması (D-047)
 *
 * D-043'ün kök nedeni token'ın global olması değildi — o token'ın HANGİ BOTA
 * ait olduğunun hiçbir yerde görünmemesiydi. Ayrı bir test botu (@BuKoTest749_bot)
 * artık mevcut, ama `.env`'e yanlışlıkla ÜRETİM token'ı konursa yerel bir boot
 * yine üretimi ele geçirir — ve bu sessizce olur.
 *
 * Bu yüzden servis açılışta hangi botu sürdüğünü loglar; üretim DIŞINDA
 * `warn` seviyesinde, çünkü hata tam da orada yapılıyor.
 *
 * grammY `Bot` sınıfı mock'lanır: gerçek `init()` ağ çağrısı yapardı.
 * ════════════════════════════════════════════════════════════════════════════
 */

const initMock = jest.fn();
const startMock = jest.fn();

jest.mock('grammy', () => ({
  Bot: jest.fn().mockImplementation(() => ({
    init: initMock,
    start: startMock,
    api: { sendMessage: jest.fn(), setWebhook: jest.fn() },
    botInfo: { username: 'BuKoTest749_bot', id: 1 },
    on: jest.fn(),
    command: jest.fn(),
    callbackQuery: jest.fn(),
    catch: jest.fn(),
    use: jest.fn(),
    stop: jest.fn(),
  })),
  InputFile: jest.fn(),
}));

const { TelegramService } = require('./telegram.service');

function makeConfig(overrides: Partial<AppConfigService> = {}): AppConfigService {
  return {
    telegramMode: 'polling',
    telegramBotToken: '123456:AA-sahte-token',
    telegramSkipStartup: false,
    isProduction: false,
    nodeEnv: 'development',
    ...overrides,
  } as AppConfigService;
}

describe('Telegram bot kimliği açılışta loglanır (D-047)', () => {
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    initMock.mockResolvedValue(undefined);
    startMock.mockImplementation(({ onStart }: { onStart?: () => void }) => {
      onStart?.();
      return new Promise(() => {}); // polling resolve etmez
    });
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('üretim DIŞINDA bot adı UYARI olarak loglanır', async () => {
    const service = new TelegramService(makeConfig({ isProduction: false }));
    await service.onModuleInit();

    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('@BuKoTest749_bot'))).toBe(true);
    // Ortam ve mod da görünmeli — yanlış bota bağlandığını fark etmenin yolu bu.
    expect(messages.some((m) => m.includes('mod=polling'))).toBe(true);
    expect(messages.some((m) => m.includes('ÜRETİM botu olmadığından'))).toBe(true);
  });

  it('üretimde bot adı normal LOG olarak yazılır (gürültü yapmaz)', async () => {
    const service = new TelegramService(
      makeConfig({ isProduction: true, nodeEnv: 'production' }),
    );
    await service.onModuleInit();

    const logs = logSpy.mock.calls.map((c) => String(c[0]));
    expect(logs.some((m) => m.includes('@BuKoTest749_bot (production)'))).toBe(true);
  });

  it('TELEGRAM_SKIP_STARTUP açıkken init() HİÇ çağrılmaz (D-043 korunur)', async () => {
    const service = new TelegramService(makeConfig({ telegramSkipStartup: true }));
    await service.onModuleInit();

    // Kimlik logu D-043 guard'ının ÖNÜNE geçmemeli: `init()` bir ağ
    // çağrısıdır ve bot nesnesi hiç oluşturulmamalıdır.
    expect(initMock).not.toHaveBeenCalled();
    expect(service.api).toBeUndefined();
  });
});

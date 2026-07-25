import { AppConfigService } from '../../../config/config.service';
import { TelegramService } from './telegram.service';

function makeConfig(overrides: Partial<AppConfigService> = {}): AppConfigService {
  return {
    telegramMode: 'disabled',
    telegramBotToken: undefined,
    ...overrides,
  } as AppConfigService;
}

/** Gerçek grammY Bot'unu (ağ çağrısı yapan) devreye sokmadan iç durumu kurar. */
function primeFakeBot(service: TelegramService, sendMessage: jest.Mock): void {
  (service as unknown as { bot: unknown }).bot = { api: { sendMessage } };
  (service as unknown as { running: boolean }).running = true;
}

describe('TelegramService — yaşam döngüsü (KRİTİK: token yoksa çökmemeli)', () => {
  it('TELEGRAM_MODE=disabled iken bot başlatılmaz, hata fırlatılmaz', async () => {
    const service = new TelegramService(makeConfig({ telegramMode: 'disabled' }));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.isRunning).toBe(false);
    expect(service.api).toBeUndefined();
  });

  it('TELEGRAM_MODE=polling ama token tanımsızken bot başlatılmaz, hata fırlatılmaz', async () => {
    const service = new TelegramService(
      makeConfig({ telegramMode: 'polling', telegramBotToken: undefined }),
    );
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.isRunning).toBe(false);
  });

  it('TELEGRAM_MODE=webhook ama token tanımsızken bot başlatılmaz, hata fırlatılmaz', async () => {
    const service = new TelegramService(
      makeConfig({ telegramMode: 'webhook', telegramBotToken: undefined }),
    );
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.isRunning).toBe(false);
  });

  it('bot hiç başlamamışken onModuleDestroy hata fırlatmaz', async () => {
    const service = new TelegramService(makeConfig());
    await service.onModuleInit();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('getFileDownloadUrl token yokken anlamlı hata fırlatır', () => {
    const service = new TelegramService(makeConfig({ telegramBotToken: undefined }));
    expect(() => service.getFileDownloadUrl('photos/f1.jpg')).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
  });

  it('getFileDownloadUrl token varken doğru URL üretir (token adapter\'a sızmaz)', () => {
    const service = new TelegramService(makeConfig({ telegramBotToken: 'abc:123' }));
    expect(service.getFileDownloadUrl('photos/f1.jpg')).toBe(
      'https://api.telegram.org/file/botabc:123/photos/f1.jpg',
    );
  });
});

describe('TelegramService — dispatch ve AI şeffaflığı (CLAUDE.md §7)', () => {
  it('/start komutunda AI şeffaflık mesajı otomatik gönderilir', async () => {
    const service = new TelegramService(makeConfig());
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    primeFakeBot(service, sendMessage);

    const handler = jest.fn().mockResolvedValue(undefined);
    service.registerHandler(handler);

    await service.dispatch({
      message: { chat: { id: 42 }, from: { id: 42, language_code: 'de' }, text: '/start' },
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = sendMessage.mock.calls[0];
    expect(chatId).toBe('42');
    expect(text).toMatch(/RECHTSBERATUNG/);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ kind: 'command', command: 'start' });
  });

  it('normal metin mesajında AI şeffaflık mesajı gönderilmez', async () => {
    const service = new TelegramService(makeConfig());
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    primeFakeBot(service, sendMessage);

    const handler = jest.fn().mockResolvedValue(undefined);
    service.registerHandler(handler);

    await service.dispatch({ message: { chat: { id: 7 }, text: 'merhaba' } });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('callback_query güncellemesi handler\'a "callback" olarak akar', async () => {
    const service = new TelegramService(makeConfig());
    const handler = jest.fn().mockResolvedValue(undefined);
    service.registerHandler(handler);

    await service.dispatch({
      callback_query: { id: 'cb', from: { id: 1 }, data: 'approve:draft-1', message: { chat: { id: 1 } } },
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'callback', callbackData: 'approve:draft-1' }),
    );
  });

  it('birden fazla handler kayıtlıysa hepsi çağrılır', async () => {
    const service = new TelegramService(makeConfig());
    const first = jest.fn().mockResolvedValue(undefined);
    const second = jest.fn().mockResolvedValue(undefined);
    service.registerHandler(first);
    service.registerHandler(second);

    await service.dispatch({ message: { chat: { id: 1 }, text: 'x' } });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('tanınmayan update sessizce yok sayılır', async () => {
    const service = new TelegramService(makeConfig());
    const handler = jest.fn().mockResolvedValue(undefined);
    service.registerHandler(handler);

    await service.dispatch({});

    expect(handler).not.toHaveBeenCalled();
  });

  it('handler hata fırlatırsa diğer handlerlar yine de çalışır (dispatch çökmez)', async () => {
    const service = new TelegramService(makeConfig());
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    const ok = jest.fn().mockResolvedValue(undefined);
    service.registerHandler(failing);
    service.registerHandler(ok);

    await expect(
      service.dispatch({ message: { chat: { id: 1 }, text: 'x' } }),
    ).resolves.toBeUndefined();

    expect(ok).toHaveBeenCalledTimes(1);
  });
});

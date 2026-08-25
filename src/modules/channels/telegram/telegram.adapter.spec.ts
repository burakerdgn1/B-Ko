import { TELEGRAM_MESSAGE_LIMIT } from '../channel.adapter';
import { TelegramAdapter } from './telegram.adapter';
import { TelegramService } from './telegram.service';

interface FakeApi {
  sendMessage: jest.Mock;
  sendDocument: jest.Mock;
  getFile: jest.Mock;
}

function makeFakeApi(): FakeApi {
  return {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    sendDocument: jest.fn().mockResolvedValue(undefined),
    getFile: jest.fn(),
  };
}

function makeService(api: FakeApi | undefined): TelegramService {
  return {
    api,
    registerHandler: jest.fn(),
    getFileDownloadUrl: (filePath: string) =>
      `https://api.telegram.org/file/bottest-token/${filePath}`,
  } as unknown as TelegramService;
}

describe('TelegramAdapter', () => {
  it('kind alanı "telegram"dır', () => {
    const adapter = new TelegramAdapter(makeService(makeFakeApi()));
    expect(adapter.kind).toBe('telegram');
  });

  describe('bot çalışmıyorken (disabled/token yok)', () => {
    it('sendMessage anlamlı hata fırlatır (sessizce yutmaz)', async () => {
      const adapter = new TelegramAdapter(makeService(undefined));
      await expect(adapter.sendMessage('1', 'merhaba')).rejects.toThrow(
        /Telegram botu çalışmıyor/,
      );
    });

    it('sendDocument anlamlı hata fırlatır', async () => {
      const adapter = new TelegramAdapter(makeService(undefined));
      await expect(
        adapter.sendDocument('1', Buffer.from('x'), 'a.pdf'),
      ).rejects.toThrow(/Telegram botu çalışmıyor/);
    });

    it('presentApproval anlamlı hata fırlatır', async () => {
      const adapter = new TelegramAdapter(makeService(undefined));
      await expect(
        adapter.presentApproval('1', { draftId: 'd1', title: 't', body: 'b' }),
      ).rejects.toThrow(/Telegram botu çalışmıyor/);
    });

    it('downloadIncomingFile anlamlı hata fırlatır', async () => {
      const adapter = new TelegramAdapter(makeService(undefined));
      await expect(adapter.downloadIncomingFile('f1')).rejects.toThrow(
        /Telegram botu çalışmıyor/,
      );
    });
  });

  describe('sendMessage — uzun mesaj bölme (4096 sınırı)', () => {
    it('kısa metni tek çağrıda gönderir', async () => {
      const api = makeFakeApi();
      const adapter = new TelegramAdapter(makeService(api));
      await adapter.sendMessage('chat-1', 'merhaba');
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
      expect(api.sendMessage).toHaveBeenCalledWith('chat-1', 'merhaba', {
        parse_mode: undefined,
      });
    });

    it('4096 karakteri aşan metni birden fazla çağrıya böler', async () => {
      const api = makeFakeApi();
      const adapter = new TelegramAdapter(makeService(api));
      const longText = 'a'.repeat(TELEGRAM_MESSAGE_LIMIT + 500);

      await adapter.sendMessage('chat-1', longText);

      expect(api.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
      const joined = api.sendMessage.mock.calls.map((c) => c[1]).join('');
      expect(joined).toBe(longText);
      for (const call of api.sendMessage.mock.calls) {
        expect((call[1] as string).length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
      }
    });

    it('markdown seçeneği parse_mode olarak iletilir', async () => {
      const api = makeFakeApi();
      const adapter = new TelegramAdapter(makeService(api));
      await adapter.sendMessage('chat-1', '*kalın*', { markdown: true });
      expect(api.sendMessage).toHaveBeenCalledWith('chat-1', '*kalın*', {
        parse_mode: 'Markdown',
      });
    });
  });

  describe('presentApproval', () => {
    it('approve:<id> / reject:<id> callback data ile inline keyboard gönderir', async () => {
      const api = makeFakeApi();
      const adapter = new TelegramAdapter(makeService(api));

      await adapter.presentApproval('chat-1', {
        draftId: 'draft-42',
        title: 'Taslak Yanıt',
        body: 'Sayın yetkili, ekte istenen belgeler bulunmaktadır.',
      });

      expect(api.sendMessage).toHaveBeenCalledTimes(1);
      const [, text, other] = api.sendMessage.mock.calls[0];
      expect(text).toContain('Taslak Yanıt');
      expect(other.reply_markup.inline_keyboard[0][0].callback_data).toBe(
        'approve:draft-42',
      );
      expect(other.reply_markup.inline_keyboard[0][1].callback_data).toBe(
        'reject:draft-42',
      );
    });

    it('özel approveLabel/rejectLabel kullanılır', async () => {
      const api = makeFakeApi();
      const adapter = new TelegramAdapter(makeService(api));

      await adapter.presentApproval('chat-1', {
        draftId: 'draft-1',
        title: 't',
        body: 'b',
        approveLabel: 'Kabul Et',
        rejectLabel: 'Geri Çevir',
      });

      const [, , other] = api.sendMessage.mock.calls[0];
      expect(other.reply_markup.inline_keyboard[0][0].text).toBe('Kabul Et');
      expect(other.reply_markup.inline_keyboard[0][1].text).toBe('Geri Çevir');
    });

    it('uzun taslak metninde onay butonları yalnızca son parçada olur', async () => {
      const api = makeFakeApi();
      const adapter = new TelegramAdapter(makeService(api));
      const longBody = 'x'.repeat(TELEGRAM_MESSAGE_LIMIT + 200);

      await adapter.presentApproval('chat-1', {
        draftId: 'draft-1',
        title: 't',
        body: longBody,
      });

      expect(api.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
      const nonLastCalls = api.sendMessage.mock.calls.slice(0, -1);
      const lastCall = api.sendMessage.mock.calls[api.sendMessage.mock.calls.length - 1];
      for (const call of nonLastCalls) {
        expect(call[2].reply_markup).toBeUndefined();
      }
      expect(lastCall[2].reply_markup).toBeDefined();
    });
  });

  describe('downloadIncomingFile', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('Telegram file API üzerinden dosyayı indirir ve mime-type çıkarır', async () => {
      const api = makeFakeApi();
      api.getFile.mockResolvedValue({ file_path: 'documents/file_1.pdf' });
      const bytes = new Uint8Array([1, 2, 3, 4]);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer,
      });

      const adapter = new TelegramAdapter(makeService(api));
      const result = await adapter.downloadIncomingFile('file-1');

      expect(api.getFile).toHaveBeenCalledWith('file-1');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/file/bottest-token/documents/file_1.pdf',
      );
      expect(result.mimeType).toBe('application/pdf');
      expect(Buffer.compare(result.buffer, Buffer.from(bytes))).toBe(0);
    });

    it('file_path yoksa anlamlı hata fırlatır', async () => {
      const api = makeFakeApi();
      api.getFile.mockResolvedValue({});
      const adapter = new TelegramAdapter(makeService(api));
      await expect(adapter.downloadIncomingFile('file-1')).rejects.toThrow(
        /file_path/,
      );
    });

    it('HTTP hatası anlamlı hata olarak yükseltilir', async () => {
      const api = makeFakeApi();
      api.getFile.mockResolvedValue({ file_path: 'photos/f.jpg' });
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });

      const adapter = new TelegramAdapter(makeService(api));
      await expect(adapter.downloadIncomingFile('file-1')).rejects.toThrow(/404/);
    });
  });

  describe('onMessage', () => {
    it('handler kaydını TelegramService.registerHandler\'a devreder', () => {
      const service = makeService(makeFakeApi());
      const adapter = new TelegramAdapter(service);
      const handler = async () => undefined;
      adapter.onMessage(handler);
      expect(service.registerHandler).toHaveBeenCalledWith(handler);
    });
  });
});

import { IncomingMessage } from '../channel.adapter';
import { MockChannelAdapter } from './mock.adapter';

describe('MockChannelAdapter', () => {
  let adapter: MockChannelAdapter;

  beforeEach(() => {
    adapter = new MockChannelAdapter();
  });

  it('kind alanı "mock"tur (WhatsApp yerine geçen kanal, D-002)', () => {
    expect(adapter.kind).toBe('mock');
  });

  describe('sendMessage', () => {
    it('gönderilen mesajı sentMessages dizisinde biriktirir', async () => {
      await adapter.sendMessage('user-1', 'merhaba');
      expect(adapter.sentMessages).toEqual([
        { channelUserId: 'user-1', text: 'merhaba', markdown: false },
      ]);
    });

    it('markdown seçeneğini kaydeder', async () => {
      await adapter.sendMessage('user-1', '*kalın*', { markdown: true });
      expect(adapter.sentMessages[0].markdown).toBe(true);
    });

    it('birden fazla mesaj sırayla birikir', async () => {
      await adapter.sendMessage('user-1', 'bir');
      await adapter.sendMessage('user-2', 'iki');
      expect(adapter.sentMessages).toHaveLength(2);
      expect(adapter.sentMessages[1]).toMatchObject({ channelUserId: 'user-2', text: 'iki' });
    });
  });

  describe('sendDocument', () => {
    it('gönderilen belgeyi sentDocuments dizisinde biriktirir', async () => {
      const buf = Buffer.from('pdf-içeriği');
      await adapter.sendDocument('user-1', buf, 'mektup.pdf', 'açıklama');
      expect(adapter.sentDocuments).toEqual([
        { channelUserId: 'user-1', file: buf, fileName: 'mektup.pdf', caption: 'açıklama' },
      ]);
    });
  });

  describe('presentApproval', () => {
    it('onay isteğini approvalRequests dizisinde biriktirir', async () => {
      await adapter.presentApproval('user-1', {
        draftId: 'draft-1',
        title: 'Taslak Yanıt',
        body: 'Sayın yetkili, ...',
      });
      expect(adapter.approvalRequests).toHaveLength(1);
      expect(adapter.approvalRequests[0]).toMatchObject({
        channelUserId: 'user-1',
        request: { draftId: 'draft-1', title: 'Taslak Yanıt' },
      });
    });
  });

  describe('downloadIncomingFile', () => {
    it('registerIncomingFile ile kaydedilen dosyayı döner', async () => {
      const buf = Buffer.from([1, 2, 3]);
      adapter.registerIncomingFile('file-1', buf, 'image/jpeg');
      const result = await adapter.downloadIncomingFile('file-1');
      expect(result).toEqual({ buffer: buf, mimeType: 'image/jpeg' });
    });

    it('kayıtlı olmayan fileId için anlamlı hata fırlatır', async () => {
      await expect(adapter.downloadIncomingFile('bilinmeyen')).rejects.toThrow(
        /bilinmeyen/,
      );
    });
  });

  describe('onMessage / simulateIncoming', () => {
    it('simulateIncoming, kayıtlı handlerı gelen mesajla tetikler', async () => {
      const received: IncomingMessage[] = [];
      adapter.onMessage(async (msg) => {
        received.push(msg);
      });

      const msg: IncomingMessage = {
        channel: 'mock',
        channelUserId: 'user-1',
        kind: 'text',
        text: 'merhaba bot',
      };
      await adapter.simulateIncoming(msg);

      expect(received).toEqual([msg]);
    });

    it('birden fazla handler kayıtlıysa hepsi sırayla çağrılır', async () => {
      const calls: string[] = [];
      adapter.onMessage(async () => {
        calls.push('birinci');
      });
      adapter.onMessage(async () => {
        calls.push('ikinci');
      });

      await adapter.simulateIncoming({
        channel: 'mock',
        channelUserId: 'user-1',
        kind: 'command',
        command: 'start',
      });

      expect(calls).toEqual(['birinci', 'ikinci']);
    });

    it('hiç handler kayıtlı değilken simulateIncoming hata fırlatmaz', async () => {
      await expect(
        adapter.simulateIncoming({
          channel: 'mock',
          channelUserId: 'user-1',
          kind: 'text',
          text: 'merhaba',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('reset', () => {
    it('tüm birikmiş kayıtları temizler', async () => {
      await adapter.sendMessage('user-1', 'x');
      await adapter.sendDocument('user-1', Buffer.from('x'), 'a.pdf');
      await adapter.presentApproval('user-1', { draftId: 'd1', title: 't', body: 'b' });
      adapter.registerIncomingFile('f1', Buffer.from('x'), 'image/jpeg');

      adapter.reset();

      expect(adapter.sentMessages).toEqual([]);
      expect(adapter.sentDocuments).toEqual([]);
      expect(adapter.approvalRequests).toEqual([]);
      await expect(adapter.downloadIncomingFile('f1')).rejects.toThrow();
    });
  });
});

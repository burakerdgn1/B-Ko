import { mapTelegramUpdateToIncoming } from './telegram.mapper';

describe('mapTelegramUpdateToIncoming', () => {
  it('düz metin mesajını "text" olarak eşler', () => {
    const result = mapTelegramUpdateToIncoming({
      message: { chat: { id: 100 }, from: { id: 100, language_code: 'tr' }, text: 'merhaba' },
    });
    expect(result).toEqual({
      channel: 'telegram',
      channelUserId: '100',
      kind: 'text',
      text: 'merhaba',
      locale: 'tr',
    });
  });

  it('"/" ile başlayan metni "command" olarak eşler ve komut adını çıkarır', () => {
    const result = mapTelegramUpdateToIncoming({
      message: { chat: { id: 5 }, from: { id: 5 }, text: '/start' },
    });
    expect(result).toMatchObject({ kind: 'command', command: 'start', text: '/start' });
  });

  it('bot adı ekli komutu doğru parse eder (/start@BukoBot)', () => {
    const result = mapTelegramUpdateToIncoming({
      message: { chat: { id: 5 }, text: '/start@BukoBot' },
    });
    expect(result).toMatchObject({ kind: 'command', command: 'start' });
  });

  it('argümanlı komutu doğru parse eder (/profil vize)', () => {
    const result = mapTelegramUpdateToIncoming({
      message: { chat: { id: 5 }, text: '/profil vize' },
    });
    expect(result).toMatchObject({ kind: 'command', command: 'profil' });
  });

  it('fotoğraf mesajını "photo" olarak eşler ve en yüksek çözünürlüğü seçer', () => {
    const result = mapTelegramUpdateToIncoming({
      message: {
        chat: { id: 7 },
        caption: 'mektubum',
        photo: [
          { file_id: 'kucuk', file_size: 100 },
          { file_id: 'buyuk', file_size: 5000 },
        ],
      },
    });
    expect(result).toMatchObject({
      kind: 'photo',
      text: 'mektubum',
      file: { fileId: 'buyuk', mimeType: 'image/jpeg', sizeBytes: 5000 },
    });
  });

  it('belge (pdf) mesajını "document" olarak eşler', () => {
    const result = mapTelegramUpdateToIncoming({
      message: {
        chat: { id: 8 },
        document: {
          file_id: 'doc-1',
          file_name: 'bescheid.pdf',
          mime_type: 'application/pdf',
          file_size: 12345,
        },
      },
    });
    expect(result).toMatchObject({
      kind: 'document',
      file: {
        fileId: 'doc-1',
        fileName: 'bescheid.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12345,
      },
    });
  });

  it('callback_query güncellemesini "callback" olarak eşler', () => {
    const result = mapTelegramUpdateToIncoming({
      callback_query: {
        id: 'cb-1',
        from: { id: 42, language_code: 'de' },
        data: 'approve:draft-9',
        message: { chat: { id: 999 } },
      },
    });
    expect(result).toEqual({
      channel: 'telegram',
      channelUserId: '999',
      kind: 'callback',
      callbackData: 'approve:draft-9',
      locale: 'de',
    });
  });

  it('callback_query mesajı silinmişse (message yok) from.id chat olarak kullanılır', () => {
    const result = mapTelegramUpdateToIncoming({
      callback_query: { id: 'cb-2', from: { id: 55 }, data: 'reject:d1' },
    });
    expect(result?.channelUserId).toBe('55');
  });

  it('işlenemeyen/boş update için null döner', () => {
    expect(mapTelegramUpdateToIncoming({})).toBeNull();
    expect(mapTelegramUpdateToIncoming({ message: { chat: { id: 1 } } })).toBeNull();
  });

  it('locale bilgisi yoksa "en" varsayılanına düşer', () => {
    const result = mapTelegramUpdateToIncoming({
      message: { chat: { id: 1 }, text: 'hi' },
    });
    expect(result?.locale).toBe('en');
  });
});

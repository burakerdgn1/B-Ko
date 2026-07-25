import {
  buildApprovalCallback,
  parseApprovalCallback,
  splitLongMessage,
  TELEGRAM_MESSAGE_LIMIT,
} from './channel.adapter';

describe('splitLongMessage', () => {
  it('limit altındaki metni tek parça döner', () => {
    expect(splitLongMessage('merhaba dünya')).toEqual(['merhaba dünya']);
  });

  it('boş metin için tek boş parça döner (sonsuz döngü yok)', () => {
    expect(splitLongMessage('')).toEqual(['']);
  });

  it('tam sınırdaki metni bölmez (sınır testi)', () => {
    const text = 'a'.repeat(TELEGRAM_MESSAGE_LIMIT);
    const parts = splitLongMessage(text);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(TELEGRAM_MESSAGE_LIMIT);
  });

  it('sınırı 1 karakter aşan metni iki parçaya böler', () => {
    const text = 'a'.repeat(TELEGRAM_MESSAGE_LIMIT + 1);
    const parts = splitLongMessage(text);
    expect(parts).toHaveLength(2);
    expect(parts.join('')).toBe(text);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });

  it('mümkünse satır sonundan böler (cümle ortadan kesilmez)', () => {
    // İlk satır sınırın az altında, ikinci satır onu aşırıyor.
    const firstLine = 'a'.repeat(TELEGRAM_MESSAGE_LIMIT - 10);
    const secondLine = 'b'.repeat(20);
    const text = `${firstLine}\n${secondLine}`;
    const parts = splitLongMessage(text);
    expect(parts[0]).toBe(firstLine);
    expect(parts[1]).toBe(secondLine);
  });

  it('çok uzun metni birden fazla parçaya böler ve kayıpsız birleşir', () => {
    const text = 'x'.repeat(TELEGRAM_MESSAGE_LIMIT * 3 + 123);
    const parts = splitLongMessage(text);
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(parts.join('')).toBe(text);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });

  it('özel limit parametresi ile çalışır', () => {
    const parts = splitLongMessage('123456789', 3);
    expect(parts).toEqual(['123', '456', '789']);
  });
});

describe('onay callback data (approve:<id> / reject:<id>)', () => {
  it('build ve parse round-trip çalışır', () => {
    const data = buildApprovalCallback('approve', 'draft-abc-123');
    expect(data).toBe('approve:draft-abc-123');
    expect(parseApprovalCallback(data)).toEqual({
      action: 'approve',
      draftId: 'draft-abc-123',
    });
  });

  it('reject callback data doğru parse edilir', () => {
    expect(parseApprovalCallback('reject:xyz')).toEqual({
      action: 'reject',
      draftId: 'xyz',
    });
  });

  it('draftId içinde ":" olsa bile tamamı yakalanır', () => {
    expect(parseApprovalCallback('approve:draft:with:colons')).toEqual({
      action: 'approve',
      draftId: 'draft:with:colons',
    });
  });

  it('geçersiz/bilinmeyen format için null döner', () => {
    expect(parseApprovalCallback('unknown:123')).toBeNull();
    expect(parseApprovalCallback('approve')).toBeNull();
    expect(parseApprovalCallback(undefined)).toBeNull();
    expect(parseApprovalCallback('')).toBeNull();
  });
});

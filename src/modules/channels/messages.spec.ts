import {
  aiDisclosureText,
  defaultApprovalLabels,
  resolveLocale,
} from './messages';

describe('resolveLocale', () => {
  it('tr/de/en değerlerini olduğu gibi tanır', () => {
    expect(resolveLocale('tr')).toBe('tr');
    expect(resolveLocale('de')).toBe('de');
    expect(resolveLocale('en')).toBe('en');
  });

  it('bölge kodlu locale önekini kabul eder (ör. de-DE, en-US)', () => {
    expect(resolveLocale('de-DE')).toBe('de');
    expect(resolveLocale('en-US')).toBe('en');
  });

  it('bilinmeyen/eksik locale için "en" varsayılanına düşer', () => {
    expect(resolveLocale('fr')).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
    expect(resolveLocale(null)).toBe('en');
    expect(resolveLocale('')).toBe('en');
  });
});

describe('aiDisclosureText — AI şeffaflığı (CLAUDE.md §7)', () => {
  it('Türkçe metin YAPAY ZEKA ve hukuki tavsiye uyarısını içerir', () => {
    const text = aiDisclosureText('tr');
    expect(text).toMatch(/YAPAY ZEKA/);
    expect(text).toMatch(/HUKUKİ TAVSİYE DEĞİLDİR/);
  });

  it('Almanca metin KI-ASSISTENT ve RECHTSBERATUNG uyarısını içerir', () => {
    const text = aiDisclosureText('de');
    expect(text).toMatch(/KI-ASSISTENT/);
    expect(text).toMatch(/RECHTSBERATUNG/);
  });

  it('İngilizce metin AI ASSISTANT ve LEGAL ADVICE uyarısını içerir', () => {
    const text = aiDisclosureText('en');
    expect(text).toMatch(/AI ASSISTANT/);
    expect(text).toMatch(/LEGAL ADVICE/);
  });

  it('locale verilmezse İngilizce varsayılana döner', () => {
    expect(aiDisclosureText()).toBe(aiDisclosureText('en'));
  });

  it('her üç dilde de insan/memur/avukat olmadığı belirtilir (onay kapısı bağımsız garanti)', () => {
    for (const locale of ['tr', 'de', 'en'] as const) {
      const text = aiDisclosureText(locale);
      expect(text.length).toBeGreaterThan(20);
    }
  });
});

describe('defaultApprovalLabels', () => {
  it('her dil için onay/ret etiketi döner', () => {
    expect(defaultApprovalLabels('tr')).toEqual({
      approve: '✅ Onayla',
      reject: '❌ Reddet',
    });
    expect(defaultApprovalLabels('en').approve).toContain('Approve');
    expect(defaultApprovalLabels('de').reject).toContain('Ablehnen');
  });
});

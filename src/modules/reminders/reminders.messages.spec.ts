import { buildReminderMessage, formatDeadlineDate } from './reminders.messages';

describe('reminders.messages', () => {
  describe('formatDeadlineDate', () => {
    it('bir Date nesnesini Almanca resmi mektup biçimine (GG.AA.YYYY) çevirir', () => {
      const d = new Date(Date.UTC(2026, 5, 30)); // 30 Haziran 2026
      expect(formatDeadlineDate(d)).toBe('30.06.2026');
    });
  });

  describe('buildReminderMessage', () => {
    const now = new Date(Date.UTC(2026, 0, 1));

    it('son tarih yoksa genel bir hatırlatma + hukuki tavsiye ibaresi döner', () => {
      const text = buildReminderMessage({ deadline: null, locale: 'tr', now });
      expect(text).toMatch(/hukuki tavsiye vermez/i);
      expect(text).not.toMatch(/\[\[[A-Z]+_\d+\]\]/);
    });

    it('son tarih varsa gerçek tarihi ve kalan gün sayısını içerir (tr)', () => {
      const deadline = new Date(Date.UTC(2026, 0, 8)); // 7 gün sonra
      const text = buildReminderMessage({
        authority: 'Ausländerbehörde Berlin',
        deadline,
        locale: 'tr',
        now,
      });
      expect(text).toContain('08.01.2026');
      expect(text).toContain('7 gün kaldı');
      expect(text).toContain('Ausländerbehörde Berlin');
      expect(text).toMatch(/hukuki tavsiye vermez/i);
      expect(text).not.toMatch(/\[\[[A-Z]+_\d+\]\]/);
    });

    it('son tarih bugünse özel bir uyarı gösterir', () => {
      const deadline = new Date(Date.UTC(2026, 0, 1));
      const text = buildReminderMessage({ deadline, locale: 'tr', now });
      expect(text).toMatch(/BUGÜN/);
    });

    it('son tarih geçmişse kaç gün geciktiğini gösterir', () => {
      const deadline = new Date(Date.UTC(2025, 11, 27)); // 5 gün önce
      const text = buildReminderMessage({ deadline, locale: 'tr', now });
      expect(text).toMatch(/5 gün önce geçti/);
    });

    it('locale=de için Almanca metin üretir', () => {
      const deadline = new Date(Date.UTC(2026, 0, 8));
      const text = buildReminderMessage({ deadline, locale: 'de', now });
      expect(text).toMatch(/Erinnerung/);
      expect(text).toMatch(/keine Rechtsberatung/i);
    });

    it('locale=en için İngilizce metin üretir', () => {
      const deadline = new Date(Date.UTC(2026, 0, 8));
      const text = buildReminderMessage({ deadline, locale: 'en', now });
      expect(text).toMatch(/Reminder/);
      expect(text).toMatch(/does not give legal advice/i);
    });

    it('authority verilmezse yerel dile göre genel bir kurum ifadesi kullanır', () => {
      const deadline = new Date(Date.UTC(2026, 0, 8));
      const text = buildReminderMessage({ deadline, locale: 'tr', now });
      expect(text).toContain('ilgili resmi kurum');
    });
  });
});

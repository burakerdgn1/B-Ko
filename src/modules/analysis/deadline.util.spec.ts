import {
  daysUntil,
  escalateRiskByDeadline,
  maxRisk,
  parseGermanDate,
  reminderDatesFor,
} from './deadline.util';

describe('deadline.util', () => {
  describe('parseGermanDate', () => {
    it.each([
      ['30.06.2024', '2024-06-30'],
      ['1.1.2025', '2025-01-01'],
      ['30. 06. 2024', '2024-06-30'],
      ['2024-06-30', '2024-06-30'],
      ['30. Juni 2024', '2024-06-30'],
      ['3. März 2025', '2025-03-03'],
      ['3. Maerz 2025', '2025-03-03'],
    ])('%s → %s', (input, expected) => {
      expect(parseGermanDate(input)?.toISOString().slice(0, 10)).toBe(expected);
    });

    it('iki basamaklı yılı doğru genişletir', () => {
      expect(parseGermanDate('30.06.24')?.getUTCFullYear()).toBe(2024);
      expect(parseGermanDate('30.06.98')?.getUTCFullYear()).toBe(1998);
    });

    it.each([
      ['takvimde olmayan gün', '31.02.2024'],
      ['geçersiz ay', '30.13.2024'],
      ['saçma metin', 'demnächst'],
      ['boş', ''],
      ['bilinmeyen ay adı', '30. Junius 2024'],
    ])('%s → null döner (exception atmaz)', (_label, input) => {
      expect(parseGermanDate(input)).toBeNull();
    });

    it('null/undefined güvenle işlenir', () => {
      expect(parseGermanDate(null)).toBeNull();
      expect(parseGermanDate(undefined)).toBeNull();
    });

    it('artık gün (29.02.2024) geçerlidir', () => {
      expect(parseGermanDate('29.02.2024')).not.toBeNull();
    });

    it('artık olmayan yılda 29.02 reddedilir', () => {
      expect(parseGermanDate('29.02.2023')).toBeNull();
    });
  });

  describe('daysUntil', () => {
    const now = new Date('2024-06-01T12:00:00Z');

    it('gelecekteki tarih için pozitif', () => {
      expect(daysUntil(new Date('2024-06-30T00:00:00Z'), now)).toBe(29);
    });

    it('geçmişteki tarih için negatif', () => {
      expect(daysUntil(new Date('2024-05-30T00:00:00Z'), now)).toBe(-2);
    });

    it('aynı gün → 0 (saat farkından etkilenmez)', () => {
      expect(daysUntil(new Date('2024-06-01T23:00:00Z'), now)).toBe(0);
    });
  });

  describe('escalateRiskByDeadline', () => {
    const now = new Date('2024-06-01T00:00:00Z');
    const inDays = (n: number) =>
      new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

    it('süresi geçmiş → critical', () => {
      expect(escalateRiskByDeadline('low', inDays(-1), now)).toBe('critical');
    });

    it('3 gün veya daha az → critical', () => {
      expect(escalateRiskByDeadline('low', inDays(2), now)).toBe('critical');
    });

    it('7 gün → high', () => {
      expect(escalateRiskByDeadline('low', inDays(7), now)).toBe('high');
    });

    it('14 gün → medium', () => {
      expect(escalateRiskByDeadline('low', inDays(14), now)).toBe('medium');
    });

    it('uzak tarih modelin riskini korur', () => {
      expect(escalateRiskByDeadline('medium', inDays(60), now)).toBe('medium');
    });

    it('riski ASLA düşürmez — modelin critical dediği critical kalır', () => {
      expect(escalateRiskByDeadline('critical', inDays(90), now)).toBe('critical');
    });

    it('son tarih yoksa modelin riski aynen kalır', () => {
      expect(escalateRiskByDeadline('high', null, now)).toBe('high');
    });
  });

  describe('maxRisk', () => {
    it('daha yüksek olanı seçer', () => {
      expect(maxRisk('low', 'high')).toBe('high');
      expect(maxRisk('critical', 'medium')).toBe('critical');
      expect(maxRisk('medium', 'medium')).toBe('medium');
    });
  });

  describe('reminderDatesFor', () => {
    const now = new Date('2024-06-01T00:00:00Z');

    it('14/7/3/1 gün önce, artan sırada', () => {
      const deadline = new Date('2024-06-30T00:00:00Z');
      const dates = reminderDatesFor(deadline, now);
      expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
        '2024-06-16',
        '2024-06-23',
        '2024-06-27',
        '2024-06-29',
      ]);
    });

    it('geçmişte kalan hatırlatmaları eler', () => {
      const deadline = new Date('2024-06-05T00:00:00Z');
      const dates = reminderDatesFor(deadline, now);
      expect(dates.every((d) => d.getTime() > now.getTime())).toBe(true);
      expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
        '2024-06-02',
        '2024-06-04',
      ]);
    });

    it('son tarih çok yakınsa boş dizi döner', () => {
      expect(reminderDatesFor(new Date('2024-06-01T06:00:00Z'), now)).toEqual([]);
    });
  });
});

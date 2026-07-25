import { RiskLevel } from '../../common/types/domain';

/**
 * Almanca tarih ayrıştırma ve risk türetme yardımcıları.
 *
 * Bağlam (D-009): model son tarihi `[[DATE_n]]` token'ı olarak döndürür; token
 * yerelde unmask edilince "30.06.2024" gibi bir Almanca tarih dizesi elde edilir.
 * Bu dosya o dizeyi güvenilir bir `Date`'e çevirir.
 */

const GERMAN_MONTHS: Record<string, number> = {
  januar: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
};

/**
 * Almanca/ISO tarih dizesini UTC `Date`'e çevirir.
 * Desteklenen: `30.06.2024`, `30.6.24`, `2024-06-30`, `30. Juni 2024`.
 *
 * @returns geçersiz/ayrıştırılamaz girdide `null` (asla exception atmaz)
 */
export function parseGermanDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const s = input.trim();

  // ISO: 2024-06-30
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return buildDate(+iso[1], +iso[2], +iso[3]);

  // Noktalı: 30.06.2024 | 30.6.24 | 30. 06. 2024
  const dotted = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})$/.exec(s);
  if (dotted) return buildDate(normalizeYear(+dotted[3]), +dotted[2], +dotted[1]);

  // Uzun: 30. Juni 2024
  const long = /^(\d{1,2})\.\s?([A-Za-zÄÖÜäöüß]+)\s+(\d{4})$/.exec(s);
  if (long) {
    const month = GERMAN_MONTHS[long[2].toLowerCase()];
    if (month) return buildDate(+long[3], month, +long[1]);
  }

  return null;
}

/**
 * İki basamaklı yılı 4 basamağa çevirir. Resmi mektuplarda geçmiş tarihler de
 * bulunabildiğinden 70+ → 19xx, aksi → 20xx (POSIX geleneği).
 */
function normalizeYear(year: number): number {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

/**
 * Takvim olarak GERÇEKTEN var olan bir tarih mi kontrol eder (31.02 gibi
 * girdiler `Date` tarafından sessizce kaydırılır — bunu reddediyoruz).
 */
function buildDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null; // taşma (ör. 31.02.2024)
  }
  return d;
}

/** Son tarihe kalan tam gün sayısı. Geçmiş tarihler negatif döner. */
export function daysUntil(deadline: Date, now: Date = new Date()): number {
  const startOfDay = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round(
    (startOfDay(deadline) - startOfDay(now)) / (24 * 60 * 60 * 1000),
  );
}

/**
 * Son tarihe kalan süreye göre risk seviyesini yükseltir.
 *
 * Model kendi risk tahminini verir, ancak zaman baskısı nesnel bir olgudur:
 * süresi geçmiş veya 3 günden az kalmış bir işlem, modelin ne dediğinden
 * bağımsız olarak kritiktir. Risk YALNIZCA yükseltilir, asla düşürülmez —
 * modelin "critical" dediği bir şeyi takvim yüzünden hafifletmek tehlikeli olur.
 */
export function escalateRiskByDeadline(
  modelRisk: RiskLevel,
  deadline: Date | null,
  now: Date = new Date(),
): RiskLevel {
  if (!deadline) return modelRisk;

  const days = daysUntil(deadline, now);
  const timeRisk: RiskLevel =
    days < 0 ? 'critical' : days <= 3 ? 'critical' : days <= 7 ? 'high' : days <= 14 ? 'medium' : 'low';

  return maxRisk(modelRisk, timeRisk);
}

const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

/**
 * Bir son tarih için hatırlatma zamanlarını üretir.
 * Geçmişte kalan veya son tarihten sonraki noktalar elenir.
 */
export function reminderDatesFor(
  deadline: Date,
  now: Date = new Date(),
): Date[] {
  const offsetsInDays = [14, 7, 3, 1];
  return offsetsInDays
    .map((d) => new Date(deadline.getTime() - d * 24 * 60 * 60 * 1000))
    .filter((d) => d.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
}

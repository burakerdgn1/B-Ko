import { resolveLocale, SupportedLocale } from '../channels/messages';
import { daysUntil } from '../analysis/deadline.util';

/**
 * Kanal-agnostik, kullanıcıya-dönük HATIRLATMA metinleri — TEK doğruluk kaynağı
 * (bu modül için). `channels/messages.ts` genel AI-şeffaflık/onay metinlerini
 * tutar ve DEĞİŞTİRİLEMEZ (görev talimatı); hatırlatmaya özgü metinler kasıtlı
 * olarak burada, ayrı tutulur.
 *
 * ÖNEMLİ (CLAUDE.md §7): her hatırlatma "hukuki tavsiye değildir" ibaresini
 * içerir — bu, yalnızca onboarding'de değil HER gönderimde tekrarlanır.
 */

export interface ReminderMessageInput {
  /** Kurumun adı (ör. 'Ausländerbehörde Berlin') — UNMASK edilmiş olmalı. */
  authority?: string | null;
  /** Talep türü (ör. 'Unterlagennachforderung') — UNMASK edilmiş olmalı. */
  requestType?: string | null;
  /** Gerçek (unmask edilmiş/hiç maskelenmemiş) son tarih. */
  deadline: Date | null;
  locale?: string | null;
  /** Test edilebilirlik için — varsayılan `new Date()`. */
  now?: Date;
}

const DISCLAIMER: Record<SupportedLocale, string> = {
  tr: 'BüKo bir yapay zeka asistanıdır ve hukuki tavsiye vermez — bu yalnızca bir hatırlatmadır.',
  de: 'BüKo ist ein KI-Assistent und gibt keine Rechtsberatung — dies ist nur eine Erinnerung.',
  en: 'BüKo is an AI assistant and does not give legal advice — this is only a reminder.',
};

const GENERIC_AUTHORITY: Record<SupportedLocale, string> = {
  tr: 'ilgili resmi kurum',
  de: 'die zuständige Behörde',
  en: 'the relevant authority',
};

const GENERIC_FALLBACK: Record<SupportedLocale, string> = {
  tr: '⏰ Hatırlatma: bekleyen bir resmi işleminiz var, lütfen durumunuzu kontrol edin.',
  de: '⏰ Erinnerung: Sie haben einen offenen behördlichen Vorgang — bitte prüfen Sie den Status.',
  en: '⏰ Reminder: you have a pending official matter — please check its status.',
};

/** Son tarihe göre kalan/geçen gün metnini üretir. */
function daysLabel(days: number, locale: SupportedLocale): string {
  if (days < 0) {
    const overdue = Math.abs(days);
    return {
      tr: `⚠️ Son tarih ${overdue} gün önce geçti!`,
      de: `⚠️ Die Frist ist vor ${overdue} Tag(en) abgelaufen!`,
      en: `⚠️ The deadline passed ${overdue} day(s) ago!`,
    }[locale];
  }
  if (days === 0) {
    return {
      tr: '⚠️ Son tarih BUGÜN!',
      de: '⚠️ Die Frist ist HEUTE!',
      en: '⚠️ The deadline is TODAY!',
    }[locale];
  }
  return {
    tr: `${days} gün kaldı.`,
    de: `Noch ${days} Tag(e).`,
    en: `${days} day(s) left.`,
  }[locale];
}

/** `Date`'i Almanca resmi mektup biçimine çevirir (bkz. `deadline.util.parseGermanDate`). */
export function formatDeadlineDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Gönderim anında (RemindersService içinde) üretilen, UNMASK EDİLMİŞ
 * hatırlatma metni. Analiz kayıtları maskeli tutulduğundan, bu fonksiyona
 * verilen `authority`/`requestType` çağıran tarafından ÖNCEDEN unmask
 * edilmiş olmalıdır (bkz. `RemindersService.sendReminder`).
 */
export function buildReminderMessage(input: ReminderMessageInput): string {
  const locale = resolveLocale(input.locale);

  if (!input.deadline) {
    return `${GENERIC_FALLBACK[locale]}\n\n${DISCLAIMER[locale]}`;
  }

  const now = input.now ?? new Date();
  const days = daysUntil(input.deadline, now);
  const dateStr = formatDeadlineDate(input.deadline);
  const authority = input.authority?.trim() || GENERIC_AUTHORITY[locale];
  const requestPart = input.requestType?.trim() ? ` (${input.requestType.trim()})` : '';

  const headline = {
    tr: `⏰ Hatırlatma: ${authority}${requestPart} için son tarihiniz ${dateStr}.`,
    de: `⏰ Erinnerung: Ihre Frist bei ${authority}${requestPart} ist der ${dateStr}.`,
    en: `⏰ Reminder: your deadline with ${authority}${requestPart} is ${dateStr}.`,
  }[locale];

  return `${headline}\n${daysLabel(days, locale)}\n\n${DISCLAIMER[locale]}`;
}

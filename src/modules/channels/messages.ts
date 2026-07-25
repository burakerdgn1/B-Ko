/**
 * Kanal-agnostik kullanıcıya-dönük metinler — TEK doğruluk kaynağı.
 *
 * CLAUDE.md §7 / ARCHITECTURE.md §6.4 zorunluluğu: bot her oturumda bir
 * YAPAY ZEKA olduğunu ve HUKUKİ TAVSİYE vermediğini açıkça belirtir. Bu metin
 * dağınık hardcode string'ler yerine burada toplanır ki tutarlılık/denetim
 * kolay olsun (tek yerden güncellenir, tüm kanallar aynı metni kullanır).
 */

export type SupportedLocale = 'tr' | 'de' | 'en';

const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['tr', 'de', 'en'];

/** Telegram `language_code` (veya benzeri) → desteklenen locale. Bilinmeyen → 'en'. */
export function resolveLocale(raw?: string | null): SupportedLocale {
  const candidate = (raw ?? '').trim().slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(candidate)
    ? (candidate as SupportedLocale)
    : 'en';
}

const AI_DISCLOSURE_TEXT: Record<SupportedLocale, string> = {
  tr:
    '🤖 Merhaba! Ben BüKo, resmi kurum yazışmalarında sana yardımcı olan bir ' +
    'YAPAY ZEKA asistanıyım — gerçek bir insan/memur/avukat DEĞİLİM.\n\n' +
    '⚠️ Önemli: Verdiğim bilgiler HUKUKİ TAVSİYE DEĞİLDİR; yalnızca ' +
    'bilgilendirme ve hazırlık amaçlıdır. Önemli kararlar için mutlaka ' +
    'yetkin bir avukata veya danışma merkezine başvur.\n\n' +
    'Hiçbir taslak/form senin onayın olmadan resmi bir kuruma gönderilmez.',
  de:
    '🤖 Hallo! Ich bin BüKo, ein KI-ASSISTENT (künstliche Intelligenz), der ' +
    'dir beim Umgang mit Behördenschreiben hilft — ich bin KEIN Mensch, ' +
    'Beamter oder Anwalt.\n\n' +
    '⚠️ Wichtig: Meine Angaben sind KEINE RECHTSBERATUNG, sondern dienen ' +
    'nur der Information und Vorbereitung. Wende dich bei wichtigen ' +
    'Entscheidungen unbedingt an eine qualifizierte Rechtsberatung.\n\n' +
    'Kein Entwurf/Formular wird ohne deine Zustimmung an eine Behörde ' +
    'gesendet.',
  en:
    "🤖 Hi! I'm BüKo, an AI ASSISTANT (artificial intelligence) that helps " +
    "you deal with official letters — I am NOT a human, official, or " +
    'lawyer.\n\n' +
    '⚠️ Important: My output is NOT LEGAL ADVICE; it is for information ' +
    'and preparation purposes only. Please consult a qualified lawyer or ' +
    'advice center for important decisions.\n\n' +
    'No draft/form is ever sent to an authority without your approval.',
};

/** `/start` akışında ve her yeni oturumda gösterilecek AI şeffaflık metni. */
export function aiDisclosureText(locale?: string | null): string {
  return AI_DISCLOSURE_TEXT[resolveLocale(locale)];
}

const APPROVAL_LABELS: Record<SupportedLocale, { approve: string; reject: string }> = {
  tr: { approve: '✅ Onayla', reject: '❌ Reddet' },
  de: { approve: '✅ Genehmigen', reject: '❌ Ablehnen' },
  en: { approve: '✅ Approve', reject: '❌ Reject' },
};

/** `presentApproval` çağrısına özel label verilmediğinde kullanılan varsayılanlar. */
export function defaultApprovalLabels(
  locale?: string | null,
): { approve: string; reject: string } {
  return APPROVAL_LABELS[resolveLocale(locale)];
}

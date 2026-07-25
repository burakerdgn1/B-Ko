import { RiskLevel } from '../../common/types/domain';
import { SupportedLocale, resolveLocale } from '../channels/messages';

/**
 * Sohbet akışının kullanıcıya görünen metinleri (tr/de/en).
 *
 * Neden ayrı dosya: `channels/messages.ts` kanal katmanına (AI şeffaflığı,
 * buton etiketleri) ait; burası ise ÜRÜN akışının metinleri. Kanal katmanı
 * ürün akışını bilmemeli.
 */

export interface AnalysisSummaryView {
  authority: string | null;
  summary: string;
  deadline: Date | null;
  daysLeft: number | null;
  riskLevel: RiskLevel;
  missingDocuments: Array<{ label: string; explanation?: string }>;
  nextSteps: string[];
}

const RISK_EMOJI: Record<RiskLevel, string> = {
  low: '🟢',
  medium: '🟡',
  high: '🟠',
  critical: '🔴',
};

const T = {
  tr: {
    welcome:
      'Merhaba! Ben BüKo — Almanya’daki resmî kurum yazışmalarınızı anlamanıza yardımcı olan bir asistanım.',
    consentAsk:
      'Devam etmeden önce: Belgelerinizi analiz edebilmem için verilerinizi işlemem gerekiyor. ' +
      'Kimlik bilgileriniz (ad, adres, numaralar) yapay zekâya gönderilmeden önce cihaz tarafında ' +
      'maskelenir ve şifreli saklanır. Onaylıyor musunuz? (/onayla)',
    consentDone:
      '✅ Teşekkürler. Artık bana bir resmî mektubun fotoğrafını veya PDF’ini gönderebilirsiniz.',
    needConsent: 'Devam etmek için lütfen önce /onayla yazın.',
    analyzing: '📄 Belgeyi inceliyorum, birkaç saniye…',
    noDeadline: 'Belirli bir son tarih tespit edilmedi.',
    daysLeft: (n: number) =>
      n < 0 ? `⚠️ ${Math.abs(n)} gün GECİKMİŞ` : `${n} gün kaldı`,
    missingTitle: 'Eksik/istenen belgeler',
    stepsTitle: 'Önerilen adımlar',
    noneListed: 'Belirtilmemiş',
    draftOffer:
      'İsterseniz bu yazıya resmî dilde bir taslak yanıt hazırlayabilirim: /taslak',
    draftIntro:
      'İşte taslak yanıtınız. Lütfen dikkatle okuyun ve kendi bilgilerinizle doğrulayın.',
    draftApproved:
      '✅ Taslağı onayladınız. Metni kopyalayıp kuruma kendiniz gönderebilirsiniz. ' +
      'BüKo hiçbir belgeyi sizin adınıza resmî kuruma göndermez.',
    draftRejected: '❌ Taslak reddedildi. Dilerseniz /taslak ile yeniden üretebilirim.',
    outOfScope:
      'ℹ️ Bu belge şu anki uzmanlık alanımın (Ausländerbehörde ve genel resmî yazışma) dışında görünüyor. ' +
      'Yine de elimden geldiğince özetledim.',
    disclaimer:
      '⚖️ BüKo hukuki tavsiye vermez; bilgilendirme ve hazırlık asistanıdır. ' +
      'Bağlayıcı konularda bir avukata veya ilgili kuruma danışın.',
    error:
      '⚠️ Belgeyi işlerken bir sorun oluştu. Lütfen daha net bir fotoğrafla tekrar deneyin.',
    unsupported:
      'Bana bir mektup fotoğrafı, PDF veya metin gönderebilirsiniz. Yardım için /yardim.',
    help:
      'Komutlar:\n/start — tanıtım\n/onayla — veri işleme onayı\n/taslak — son analiz için taslak yanıt\n/sil — verilerimi sil\n/yardim — bu mesaj',
    deleted: '🗑️ Verileriniz silindi.',
  },
  de: {
    welcome:
      'Hallo! Ich bin BüKo — ein Assistent, der Ihnen hilft, Behördenpost in Deutschland zu verstehen.',
    consentAsk:
      'Bevor wir starten: Für die Analyse muss ich Ihre Daten verarbeiten. Ihre persönlichen ' +
      'Angaben (Name, Adresse, Nummern) werden vor dem Versand an die KI lokal maskiert und ' +
      'verschlüsselt gespeichert. Sind Sie einverstanden? (/zustimmen)',
    consentDone:
      '✅ Danke. Sie können mir jetzt ein Foto oder PDF eines Behördenbriefs senden.',
    needConsent: 'Bitte schreiben Sie zuerst /zustimmen.',
    analyzing: '📄 Ich prüfe das Dokument, einen Moment…',
    noDeadline: 'Keine konkrete Frist erkannt.',
    daysLeft: (n: number) =>
      n < 0 ? `⚠️ ${Math.abs(n)} Tage ÜBERFÄLLIG` : `noch ${n} Tage`,
    missingTitle: 'Fehlende/angeforderte Unterlagen',
    stepsTitle: 'Empfohlene Schritte',
    noneListed: 'Nicht angegeben',
    draftOffer:
      'Auf Wunsch erstelle ich einen förmlichen Antwortentwurf: /entwurf',
    draftIntro:
      'Hier ist Ihr Entwurf. Bitte sorgfältig prüfen und mit Ihren eigenen Angaben abgleichen.',
    draftApproved:
      '✅ Sie haben den Entwurf freigegeben. Sie können den Text kopieren und selbst an die ' +
      'Behörde senden. BüKo versendet nichts in Ihrem Namen.',
    draftRejected: '❌ Entwurf abgelehnt. Mit /entwurf erstelle ich gern einen neuen.',
    outOfScope:
      'ℹ️ Dieses Dokument liegt außerhalb meines Schwerpunkts (Ausländerbehörde und allgemeine Behördenpost).',
    disclaimer:
      '⚖️ BüKo bietet keine Rechtsberatung, sondern Information und Vorbereitung. ' +
      'Bei verbindlichen Fragen wenden Sie sich an eine Anwältin/einen Anwalt oder die Behörde.',
    error:
      '⚠️ Beim Verarbeiten ist ein Problem aufgetreten. Bitte versuchen Sie es mit einem klareren Foto.',
    unsupported:
      'Senden Sie mir ein Foto, PDF oder Text eines Briefes. Hilfe: /hilfe.',
    help:
      'Befehle:\n/start — Einführung\n/zustimmen — Einwilligung\n/entwurf — Antwortentwurf\n/loeschen — Daten löschen\n/hilfe — diese Nachricht',
    deleted: '🗑️ Ihre Daten wurden gelöscht.',
  },
  en: {
    welcome:
      'Hello! I’m BüKo — an assistant that helps you understand official letters from German authorities.',
    consentAsk:
      'Before we begin: to analyse your documents I need to process your data. Your personal ' +
      'details (name, address, numbers) are masked locally before anything is sent to the AI, ' +
      'and stored encrypted. Do you agree? (/agree)',
    consentDone: '✅ Thank you. You can now send me a photo or PDF of an official letter.',
    needConsent: 'Please type /agree first.',
    analyzing: '📄 Reviewing the document, one moment…',
    noDeadline: 'No specific deadline detected.',
    daysLeft: (n: number) =>
      n < 0 ? `⚠️ ${Math.abs(n)} days OVERDUE` : `${n} days left`,
    missingTitle: 'Missing/requested documents',
    stepsTitle: 'Suggested next steps',
    noneListed: 'Not specified',
    draftOffer: 'If you like, I can prepare a formal draft reply: /draft',
    draftIntro:
      'Here is your draft. Please read it carefully and verify it against your own records.',
    draftApproved:
      '✅ You approved the draft. You can copy the text and send it to the authority yourself. ' +
      'BüKo never sends anything to an authority on your behalf.',
    draftRejected: '❌ Draft rejected. I can generate a new one with /draft.',
    outOfScope:
      'ℹ️ This document appears to be outside my current focus (Ausländerbehörde and general official mail).',
    disclaimer:
      '⚖️ BüKo does not provide legal advice; it is an information and preparation assistant. ' +
      'For binding matters, consult a lawyer or the authority directly.',
    error:
      '⚠️ Something went wrong while processing. Please try again with a clearer photo.',
    unsupported: 'Send me a photo, PDF or text of a letter. Help: /help.',
    help:
      'Commands:\n/start — intro\n/agree — data consent\n/draft — draft reply\n/delete — delete my data\n/help — this message',
    deleted: '🗑️ Your data has been deleted.',
  },
} as const;

export function t(locale?: string | null): (typeof T)[SupportedLocale] {
  return T[resolveLocale(locale)];
}

/** Analiz sonucunu kullanıcıya gösterilecek mesaja çevirir. */
export function formatAnalysis(
  view: AnalysisSummaryView,
  locale?: string | null,
): string {
  const m = t(locale);
  const lines: string[] = [];

  lines.push(`${RISK_EMOJI[view.riskLevel]} *${view.authority ?? 'Behörde'}*`);
  lines.push('');
  lines.push(view.summary);
  lines.push('');

  if (view.deadline) {
    const date = view.deadline.toLocaleDateString('de-DE', { timeZone: 'UTC' });
    const left = view.daysLeft !== null ? ` — ${m.daysLeft(view.daysLeft)}` : '';
    lines.push(`📅 *${date}*${left}`);
  } else {
    lines.push(`📅 ${m.noDeadline}`);
  }
  lines.push('');

  lines.push(`📎 *${m.missingTitle}:*`);
  if (view.missingDocuments.length === 0) {
    lines.push(`• ${m.noneListed}`);
  } else {
    for (const doc of view.missingDocuments) {
      lines.push(`• ${doc.label}${doc.explanation ? ` — ${doc.explanation}` : ''}`);
    }
  }
  lines.push('');

  if (view.nextSteps.length > 0) {
    lines.push(`✅ *${m.stepsTitle}:*`);
    view.nextSteps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
    lines.push('');
  }

  lines.push(m.draftOffer);
  lines.push('');
  lines.push(`_${m.disclaimer}_`);

  return lines.join('\n');
}

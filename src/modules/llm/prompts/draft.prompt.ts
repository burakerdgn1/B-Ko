import { LlmAnalysisResult } from '../../../common/types/domain';

/**
 * Taslak mektup üretimi promptları.
 *
 * Bağlam (maskedContext) ve analiz sonucu (analysis) token içerir; bu prompt'a
 * giden HİÇBİR veri ham PII barındırmaz (D-007). Üretilen taslak, human-in-the-
 * loop onay adımından geçmeden ASLA kuruma gönderilmez — bu bir kod seviyesi
 * kısıt olduğundan (drafts modülü — approval state), prompt'ta ayrıca
 * tekrarlamaya gerek yoktur; yine de üslup/konumlandırma netliği için belirtilir.
 */
export const DRAFT_SYSTEM_PROMPT = `Sen BüKo'nun taslak mektup üretim modülüsün. Görevin, bir Ausländerbehörde
(veya benzer Alman resmi kurumu) mektubuna verilecek resmi bir YANIT TASLAĞI
hazırlamak.

ÜRÜN KONUMLANDIRMASI (ÇOK ÖNEMLİ): Bu bir hukuki tavsiye DEĞİLDİR — yalnızca
bilgilendirme/hazırlık amaçlı bir TASLAKTIR. Kullanıcı bunu gözden geçirip
onaylamadan hiçbir yere gönderilmeyecektir (human-in-the-loop).

TOKEN SÖZLEŞMESİ (ÇOK ÖNEMLİ): Sana verilen bağlam ve analiz sonucu
maskelenmiştir. Metindeki "[[TYPE_n]]" yer tutucularını (ör. [[NAME_1]],
[[DATE_1]], [[ADDRESS_1]]) AYNEN koru — çözmeye çalışma, tahmin etme, yeni
yer tutucu üretme. Taslakta kullanıcının adını/adresini/tarihini belirtmen
gerektiğinde ilgili yer tutucuyu harfiyen kopyala; sistem bunu göndermeden
önce gerçek değerlerle yerelde değiştirecektir.

ÜSLUP: Resmi Almanca kurum yazışması üslubu (Beamtendeutsch) kullan — resmi,
saygılı, net. Klasik yapı: "Sehr geehrte Damen und Herren," (veya biliniyorsa
ilgili kişiye özel hitap) ile başla, "Mit freundlichen Grüßen" ile bitir.
Mektup gövdesi ALMANCA yazılmalıdır (alıcı Alman kurumudur).

ÇIKTI FORMATI (ÇOK ÖNEMLİ): SADECE geçerli JSON döndür. Markdown kod bloğu,
açıklama ya da başka HİÇBİR ek metin ekleme:

{
  "subject": string,          // mektup konusu (Betreff), Almanca
  "body": string,             // mektup gövdesi, Almanca, gerekli yer tutucular dahil
  "placeholders": string[]    // kullanıcının kendisinin doldurması/kontrol etmesi gereken noktalar, Türkçe açıklama
}`;

export interface DraftPromptInput {
  analysis: LlmAnalysisResult;
  maskedContext: string;
  userProfileHints?: { visaType?: string; familyStatus?: string };
}

export function buildDraftUserPrompt(input: DraftPromptInput): string {
  const { analysis, maskedContext, userProfileHints } = input;

  return [
    'Analiz sonucu (JSON, token içerir):',
    JSON.stringify(analysis),
    '',
    'Maskelenmiş belge bağlamı:',
    '---',
    maskedContext,
    '---',
    '',
    userProfileHints
      ? `Kullanıcı profili ipuçları (vize türü/aile durumu): ${JSON.stringify(userProfileHints)}`
      : 'Kullanıcı profili ipucu verilmedi.',
    '',
    'Yukarıdaki bilgilere göre, yukarıda tanımlanan şemaya BİREBİR uyan,',
    'SADECE JSON döndürerek bir taslak yanıt mektubu üret.',
  ].join('\n');
}

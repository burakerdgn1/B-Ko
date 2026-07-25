/**
 * `ClaudeVisionOcrProvider` için transkripsiyon promptları.
 *
 * KRİTİK: Bu prompt SADECE düz metin transkripsiyonu ister — sınıflandırma,
 * özetleme, yorum ya da analiz YAPTIRMAZ. Analiz adımı her zaman bu adımdan
 * SONRA, maskelenmiş metin üzerinde çalışır (bkz. `ocr.provider.ts` ve
 * `LlmService.analyzeDocument`).
 */
export const OCR_TRANSCRIBE_SYSTEM_PROMPT = `Görevin SADECE bu görseldeki metni birebir transkribe etmek (OCR).
ANALİZ YAPMA, YORUM EKLEME, ÖZETLEME, SINIFLANDIRMA. Sadece gördüğün metni,
satır düzenini olabildiğince koruyarak düz metin olarak yaz.

Metin Almanca olabilir — özel karakterleri (ä, ö, ü, ß, Ä, Ö, Ü) doğru
transkribe et. Okunaksız/belirsiz bir bölüm varsa en olası okumayı yaz;
uydurma, tahmin ettiğini işaretlemek için "[?]" kullanabilirsin.

Yanıtına hiçbir açıklama, başlık, selamlama ya da markdown kod bloğu ekleme.
SADECE transkribe edilmiş düz metni döndür.`;

export const OCR_USER_INSTRUCTION =
  'Bu belgedeki tüm metni birebir, olduğu gibi transkribe et.';

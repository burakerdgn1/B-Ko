import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfigService } from '../../config/config.service';
import { ANTHROPIC_CLIENT, AnthropicClientLike } from './anthropic-client';
import {
  OCR_TRANSCRIBE_SYSTEM_PROMPT,
  OCR_USER_INSTRUCTION,
} from './prompts/ocr.prompt';

export interface OcrImage {
  base64: string;
  mediaType: string;
}

/** Görsel → düz metin transkripsiyonu sağlayan soyutlama. */
export interface OcrProvider {
  transcribe(image: OcrImage): Promise<string>;
}

const SUPPORTED_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;
type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

function assertSupportedMediaType(mediaType: string): SupportedMediaType {
  if ((SUPPORTED_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    return mediaType as SupportedMediaType;
  }
  throw new Error(
    `Desteklenmeyen görsel türü: "${mediaType}". Desteklenenler: ${SUPPORTED_MEDIA_TYPES.join(', ')}.`,
  );
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * KRİTİK MİMARİ GERİLİM — bilerek ve açıkça çözülür, gizlenmez:
 *
 * CLAUDE.md hem "Claude'un native vision'ı ile OCR" hem de "PII asla çıplak
 * LLM'e gitmeden maskelenir" diyor. Bir mektup FOTOĞRAFI yapısal olarak ham
 * PII içerir — isim, adres, doğum tarihi bizzat görselin İÇİNDE yazılıdır.
 * Görseli maskelemeden önce OKUMANIN (yani hangi pikselin hangi PII'ye denk
 * geldiğini bilmeden maskelemenin) bilinen bir yolu yoktur.
 *
 * BU SAĞLAYICI (varsayılan, OCR_PROVIDER=claude-vision) SEÇİLDİĞİNDE:
 *   - Görsel, HAM (maskesiz) hâliyle Anthropic API'sine ulaşır.
 *   - Bu, bilerek kabul edilmiş TEK istisnadır ve yalnızca bu sınıfla
 *     sınırlıdır.
 *   - Bu sağlayıcı SADECE düz metin transkripsiyonu ister — analiz,
 *     sınıflandırma, deadline/risk çıkarımı, yorum YAPMAZ (bkz.
 *     `OCR_TRANSCRIBE_SYSTEM_PROMPT`).
 *   - Bu adımdan SONRAKİ HER ADIM — analiz, taslak üretimi, kalıcı depolama,
 *     denetim izi — `PiiService.mask()` çıktısıyla, yani SADECE maskeli
 *     metinle çalışır (bkz. `LlmService.analyzeDocument`: OCR çıktısı hemen
 *     maskelenir, analiz çağrısı HER ZAMAN maskeli metinle yapılır).
 *
 * Sıfır PII sızıntısı gerekiyorsa: `OCR_PROVIDER=local` → `LocalOcrProvider`
 * (tesseract.js, tamamen yerel, hiçbir görsel dış sağlayıcıya gitmez).
 * ══════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class ClaudeVisionOcrProvider implements OcrProvider {
  private readonly logger = new Logger(ClaudeVisionOcrProvider.name);

  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: AnthropicClientLike,
    private readonly config: AppConfigService,
  ) {}

  async transcribe(image: OcrImage): Promise<string> {
    const mediaType = assertSupportedMediaType(image.mediaType);

    this.logger.warn(
      "ClaudeVisionOcrProvider: HAM (maskesiz) görsel Anthropic API'sine gönderiliyor " +
        '(bilinen ve kabul edilmiş mimari istisna — bkz. sınıf yorumu). Bu adımdan sonraki ' +
        'tüm işlemler PiiService.mask() ile maskelenmiş metin üzerinde çalışacak.',
    );

    try {
      const response = await this.client.messages.create({
        model: this.config.llmModel,
        max_tokens: this.config.llmMaxTokens,
        system: OCR_TRANSCRIBE_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: image.base64 },
              },
              { type: 'text', text: OCR_USER_INSTRUCTION },
            ],
          },
        ],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();

      if (!text) {
        throw new Error('Claude Vision OCR boş metin döndürdü.');
      }
      return text;
    } catch (err) {
      throw new Error(`Claude Vision OCR başarısız: ${toErrorMessage(err)}`);
    }
  }
}

/**
 * Sıfır PII sızıntısı modu: görsel tamamen yerelde okunur, hiçbir görsel
 * bayt'ı dış bir sağlayıcıya gönderilmez.
 *
 * `tesseract.js` OPSİYONEL bir bağımlılıktır ve LAZY `import()` ile yüklenir:
 * kurulu değilse uygulama ÇÖKMEZ, bu sağlayıcı gerçekten çağrıldığında
 * anlamlı bir hata fırlatır (bkz. görev talimatı). `npm install` bu ajan
 * tarafından ÇALIŞTIRILMADI — paket package.json'a eklenmedi, bkz. çıktı
 * raporundaki "ana oturumun yapması gerekenler" bölümü.
 */
@Injectable()
export class LocalOcrProvider implements OcrProvider {
  async transcribe(image: OcrImage): Promise<string> {
    const tesseract = await this.loadTesseract();
    const buffer = Buffer.from(image.base64, 'base64');

    try {
      // Almanca resmi belgeler + Türkçe/İngilizce karışık içerik için çoklu dil.
      const { data } = await tesseract.recognize(buffer, 'deu+eng');
      return (data?.text ?? '').trim();
    } catch (err) {
      throw new Error(`Yerel OCR (tesseract.js) başarısız: ${toErrorMessage(err)}`);
    }
  }

  private async loadTesseract(): Promise<typeof import('tesseract.js')> {
    try {
      // Lazy import — kurulu değilse modül başlangıcında değil, yalnızca
      // burada (gerçekten ihtiyaç duyulduğunda) hata fırlar.
      return await import('tesseract.js');
    } catch {
      throw new Error(
        'LocalOcrProvider için "tesseract.js" paketi kurulu değil. Kurmak için: ' +
          '`npm install tesseract.js` (opsiyonel bağımlılık olarak package.json\'a eklenmeli — ' +
          'ana oturumun sorumluluğu). Alternatif olarak OCR_PROVIDER=claude-vision kullanarak ' +
          "Claude Vision tabanlı OCR'a geçebilirsiniz (bkz. MANUAL_ACTIONS_REQUIRED.md).",
      );
    }
  }
}

/** `OCR_PROVIDER` env değişkeninin kabul ettiği değerler. */
export type OcrProviderKind = 'claude-vision' | 'local';

/**
 * `OCR_PROVIDER` ortam değişkenini okur (varsayılan: `claude-vision`).
 *
 * NOT: `src/config/env.schema.ts` ana oturuma ait — bu modül onu değiştirmez,
 * bunun yerine `process.env.OCR_PROVIDER`'ı doğrudan okur. Ana oturumun
 * yapması gereken: bu değişkeni env.schema.ts'e
 * `z.enum(['claude-vision', 'local']).default('claude-vision')` olarak
 * eklemek (bkz. çıktı raporu).
 */
export function resolveOcrProviderKind(): OcrProviderKind {
  return process.env.OCR_PROVIDER === 'local' ? 'local' : 'claude-vision';
}

/** DI token — seçilen `OcrProvider` implementasyonunu enjekte etmek için. */
export const OCR_PROVIDER_TOKEN = Symbol('OCR_PROVIDER');

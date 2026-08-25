import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AppConfigService } from '../../config/config.service';
import { PiiService } from '../../common/pii/pii.service';
import { KnownPiiProfile, PiiMap } from '../../common/pii/pii.types';
import { LlmAnalysisResult, LlmDraftResult } from '../../common/types/domain';
import { ANTHROPIC_CLIENT, AnthropicClientLike } from './anthropic-client';
import { OCR_PROVIDER_TOKEN, OcrImage, OcrProvider } from './ocr.provider';
import { MockLlm, MOCK_MODEL_NAME } from './mock.llm';
import { llmAnalysisResultSchema, llmDraftResultSchema } from './llm.schemas';
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
} from './prompts/analysis.prompt';
import { DRAFT_SYSTEM_PROMPT, buildDraftUserPrompt } from './prompts/draft.prompt';

/**
 * Public API — görev sözleşmesi (ana oturum pipeline'ı bu sözleşmeye göre
 * yazılıyor). DEĞİŞTİRME.
 */
export interface AnalyzeInput {
  text?: string;
  image?: OcrImage;
  profile?: KnownPiiProfile;
}

export interface AnalyzeOutput {
  /** Token'lar İÇERİR, unmask EDİLMEMİŞ. */
  result: LlmAnalysisResult;
  /** unmask için. */
  map: PiiMap;
  /** DB'ye yazılacak maskeli metin. */
  maskedText: string;
  /** Denetim izi (maskeli). */
  rawMaskedOutput: string;
  model: string;
}

export interface GenerateDraftInput {
  analysis: LlmAnalysisResult;
  maskedContext: string;
  map: PiiMap;
  userProfileHints?: { visaType?: string; familyStatus?: string };
}

export interface GenerateDraftOutput {
  result: LlmDraftResult;
  rawMaskedOutput: string;
  model: string;
}

/** Zod doğrulaması başarısız olursa yapılacak düzeltme denemesi sayısı (görev talimatı: 1). */
const MAX_REPAIR_ATTEMPTS = 1;

type ParseAttempt<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * PII-güvenli Claude sarmalayıcı (DECISIONS D-007).
 *
 * MİMARİ KURAL: Bu sınıf ham PII içeren metni DOĞRUDAN API'ye göndermez. Ham
 * `messages.create` çağrısı YALNIZCA `callClaude()` private metodunda yaşar
 * ve bu metot yalnızca ÖNCEDEN maskelenmiş + sızıntı kontrolünden geçmiş
 * (`assertNoLeaks`) metinlerle çağrılır (bkz. `analyzeDocument`,
 * `generateDraft`). Public API bu sarmalayıcının dışına ASLA çıkmaz —
 * "kaçış" mümkün değildir.
 *
 * Akış: metin/görsel → (görselse) OcrProvider → ham metin → PiiService.mask()
 * → maskeli metin → analiz/taslak çağrısı. Analiz çağrısı HER ZAMAN maskeli
 * metinle yapılır (OCR adımındaki bilinen istisna hariç — bkz. ocr.provider.ts).
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    @Inject(ANTHROPIC_CLIENT) private readonly client: AnthropicClientLike,
    @Inject(OCR_PROVIDER_TOKEN) private readonly ocrProvider: OcrProvider,
    private readonly config: AppConfigService,
    private readonly pii: PiiService,
  ) {}

  /**
   * Belgeyi (metin veya görsel) analiz eder. Görsel verildiyse önce OCR ile
   * düz metne çevrilir; ardından metin HER ZAMAN maskelenir ve analiz çağrısı
   * yalnızca maskeli metinle yapılır.
   */
  async analyzeDocument(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const rawText = await this.resolveRawText(input);
    const { maskedText, map } = this.pii.mask(rawText, { profile: input.profile });

    if (this.config.llmMock) {
      const result = llmAnalysisResultSchema.parse(MockLlm.analyze(maskedText));
      this.logger.debug('LLM_MOCK=true — analyzeDocument deterministik mock yanıt döndürüyor.');
      return {
        result,
        map,
        maskedText,
        rawMaskedOutput: JSON.stringify(result),
        model: MOCK_MODEL_NAME,
      };
    }

    this.assertNoLeaks(maskedText, map);

    const { result, raw } = await this.completeMaskedJson(
      ANALYSIS_SYSTEM_PROMPT,
      buildAnalysisUserPrompt(maskedText),
      llmAnalysisResultSchema,
    );

    return {
      result,
      map,
      maskedText,
      rawMaskedOutput: raw,
      model: this.config.llmModel,
    };
  }

  /**
   * Taslak yanıt mektubu üretir. `maskedContext` ve `analysis` token içerir;
   * bu metoda ham PII ASLA verilmemelidir (çağıran pipeline'ın sorumluluğu —
   * bu servis kendi tarafında yine de fail-closed sızıntı kontrolü yapar).
   */
  async generateDraft(input: GenerateDraftInput): Promise<GenerateDraftOutput> {
    if (this.config.llmMock) {
      const result = llmDraftResultSchema.parse(MockLlm.draft(input));
      this.logger.debug('LLM_MOCK=true — generateDraft deterministik mock yanıt döndürüyor.');
      return { result, rawMaskedOutput: JSON.stringify(result), model: MOCK_MODEL_NAME };
    }

    this.assertNoLeaks(input.maskedContext, input.map);

    const { result, raw } = await this.completeMaskedJson(
      DRAFT_SYSTEM_PROMPT,
      buildDraftUserPrompt(input),
      llmDraftResultSchema,
    );

    return { result, rawMaskedOutput: raw, model: this.config.llmModel };
  }

  // ── iç yardımcılar ────────────────────────────────────────────────────────

  private async resolveRawText(input: AnalyzeInput): Promise<string> {
    if (input.image) {
      if (this.config.llmMock) return MockLlm.ocrText();
      return this.ocrProvider.transcribe(input.image);
    }
    if (input.text) return input.text;
    throw new Error(
      'analyzeDocument: "text" veya "image" alanlarından en az biri verilmelidir.',
    );
  }

  /**
   * Fail-closed sızıntı kontrolü. API'ye gönderilmeden HEMEN önce çağrılır;
   * sızıntı varsa çağrı YAPILMAZ (görev talimatı §"Zorunlu davranışlar" 1).
   * Sızan DEĞER asla loglanmaz, yalnızca tipi loglanır/hataya yazılır.
   */
  private assertNoLeaks(maskedText: string, map: PiiMap): void {
    const leaked = this.pii.detectLeaks(maskedText, map);
    if (leaked.length > 0) {
      this.logger.error(
        `PII sızıntısı tespit edildi — LLM çağrısı ENGELLENDİ (fail-closed). ` +
          `Sızan tipler: ${leaked.join(', ')} (değerlerin kendisi ASLA loglanmaz).`,
      );
      throw new Error(
        'PII sızıntısı tespit edildi; güvenlik nedeniyle LLM çağrısı yapılmadı. ' +
          `Sızan alan tipleri: ${leaked.join(', ')}.`,
      );
    }
  }

  /**
   * Maskelenmiş bir istemi Claude'a gönderir ve JSON çıktısını Zod ile
   * doğrular. Doğrulama başarısız olursa `MAX_REPAIR_ATTEMPTS` kez düzeltme
   * denemesi yapılır; hâlâ başarısızsa anlamlı bir hata fırlatılır.
   */
  private async completeMaskedJson<T>(
    system: string,
    userPrompt: string,
    schema: z.ZodType<T>,
  ): Promise<{ result: T; raw: string }> {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];

    let raw = await this.callClaude(system, messages);
    let attempt = this.tryParseAndValidate(raw, schema);
    let attempts = 0;

    while (!attempt.ok && attempts < MAX_REPAIR_ATTEMPTS) {
      attempts += 1;
      this.logger.warn(
        `LLM çıktısı beklenen şemaya uymadı (deneme ${attempts}/${MAX_REPAIR_ATTEMPTS + 1}), ` +
          `düzeltme isteniyor: ${attempt.error}`,
      );
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content:
          `Önceki yanıtın geçersizdi: ${attempt.error}\n` +
          'SADECE geçerli JSON döndür — markdown kod bloğu, açıklama ya da başka hiçbir metin ekleme.',
      });
      raw = await this.callClaude(system, messages);
      attempt = this.tryParseAndValidate(raw, schema);
    }

    if (!attempt.ok) {
      throw new Error(
        `LLM yanıtı beklenen şemaya uymuyor (${attempts + 1} deneme sonrası): ${attempt.error}`,
      );
    }

    return { result: attempt.value, raw };
  }

  private tryParseAndValidate<T>(raw: string, schema: z.ZodType<T>): ParseAttempt<T> {
    let json: unknown;
    try {
      json = JSON.parse(extractJsonPayload(raw));
    } catch (err) {
      return { ok: false, error: `JSON parse hatası: ${(err as Error).message}` };
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return { ok: false, error: detail };
    }
    return { ok: true, value: parsed.data };
  }

  /**
   * HAM `messages.create` çağrısı. Bilerek `private` — bu metodun dışına
   * hiçbir public metot doğrudan erişim vermez (D-007, "kaçış mümkün olmasın").
   * Yalnızca bu sınıf içindeki, önceden maskelenmiş+sızıntı-kontrollü çağrılar
   * buraya ulaşır.
   */
  private async callClaude(
    system: string,
    messages: Anthropic.MessageParam[],
  ): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.config.llmModel,
        max_tokens: this.config.llmMaxTokens,
        system,
        messages,
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();

      if (!text) {
        throw new Error('Claude boş yanıt döndürdü.');
      }
      return text;
    } catch (err: unknown) {
      if (err instanceof Anthropic.APIError) {
        throw new Error(`Claude API hatası (${err.status ?? 'bilinmiyor'}): ${err.message}`, {
          cause: err,
        });
      }
      throw new Error(
        `Claude API çağrısı başarısız: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
}

/** Model bazen JSON'u ```json ... ``` kod bloğuna sarabilir; bu durumda ayıklar. */
function extractJsonPayload(raw: string): string {
  let text = raw.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
}

import Anthropic from '@anthropic-ai/sdk';
import { AppConfigService } from '../../config/config.service';

/**
 * `LlmService` ve `OcrProvider` implementasyonlarının ihtiyaç duyduğu minimal
 * Claude istemci arayüzü.
 *
 * Neden ayrı bir arayüz (gerçek `Anthropic` sınıfı yerine): testlerde gerçek
 * `@anthropic-ai/sdk` istemcisi yerine bu arayüzü uygulayan sahte (fake) bir
 * nesne enjekte edilerek API'ye giden payload gerçek ağ çağrısı yapmadan
 * doğrulanabilir (bkz. `llm.service.spec.ts` — "maskeleme zorunluluğu" testi).
 */
export interface AnthropicClientLike {
  messages: {
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Message>;
  };
}

/** DI token — gerçek/sahte istemciyi enjekte etmek için. */
export const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');

/**
 * Gerçek `@anthropic-ai/sdk` istemcisini TEMBEL (lazy) kuran sarmalayıcı.
 *
 * Neden tembel kurulum gerekli: `new Anthropic(...)` yapıcısı, `apiKey`
 * çözümlenemezse (ne `apiKey` argümanı ne `ANTHROPIC_API_KEY` env'i varsa)
 * HEMEN fırlatır. Mock modda (LLM_MOCK=true — geliştirme/test, bkz.
 * MANUAL_ACTIONS_REQUIRED.md) API anahtarı hiç tanımlı olmayabilir; bu durumda
 * uygulama başlarken (Nest DI çözümü sırasında) çökmemelidir. Gerçek istemci
 * bu yüzden yalnızca gerçekten ihtiyaç duyulduğu ilk çağrıda kurulur.
 */
export class LazyAnthropicClient implements AnthropicClientLike {
  private real?: Anthropic;

  constructor(private readonly config: AppConfigService) {}

  get messages(): AnthropicClientLike['messages'] {
    return {
      create: (body: Anthropic.MessageCreateParamsNonStreaming) =>
        this.resolve().messages.create(body),
    };
  }

  private resolve(): Anthropic {
    if (!this.real) {
      const apiKey = this.config.anthropicApiKey;
      if (!apiKey) {
        throw new Error(
          'ANTHROPIC_API_KEY tanımlı değil ve LLM_MOCK=false. Gerçek Claude API çağrısı ' +
            "yapılamaz. `.env` dosyasında ANTHROPIC_API_KEY tanımlayın ya da geliştirme/test " +
            'için LLM_MOCK=true kullanın (bkz. MANUAL_ACTIONS_REQUIRED.md).',
        );
      }
      this.real = new Anthropic({ apiKey });
    }
    return this.real;
  }
}

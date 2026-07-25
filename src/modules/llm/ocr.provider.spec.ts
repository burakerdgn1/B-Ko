import { AppConfigService } from '../../config/config.service';
import {
  ClaudeVisionOcrProvider,
  LocalOcrProvider,
  resolveOcrProviderKind,
} from './ocr.provider';
import { AnthropicClientLike } from './anthropic-client';

/**
 * OCR sağlayıcı test seti. GERÇEK API ÇAĞRISI YAPILMAZ: `ClaudeVisionOcrProvider`
 * her zaman sahte (fake) bir `AnthropicClientLike` ile test edilir.
 * `LocalOcrProvider` içinse gerçek davranış test edilir: bu repoda
 * `tesseract.js` KURULU DEĞİL (opsiyonel bağımlılık, bkz. çıktı raporu),
 * dolayısıyla "kurulu değilse anlamlı hata fırlat" davranışını gerçek
 * (mock'lanmamış) bir senaryoyla doğrulayabiliyoruz.
 */

function fakeConfig(
  overrides: Partial<{ llmModel: string; llmMaxTokens: number }> = {},
): AppConfigService {
  return {
    llmModel: overrides.llmModel ?? 'claude-sonnet-5',
    llmMaxTokens: overrides.llmMaxTokens ?? 2048,
  } as unknown as AppConfigService;
}

describe('LocalOcrProvider', () => {
  it('tesseract.js kurulu değilse anlamlı ve eyleme geçirilebilir bir hata fırlatır', async () => {
    const provider = new LocalOcrProvider();

    await expect(
      provider.transcribe({ base64: Buffer.from('x').toString('base64'), mediaType: 'image/png' }),
    ).rejects.toThrow(/tesseract\.js/i);
  });
});

describe('ClaudeVisionOcrProvider', () => {
  it('desteklenmeyen görsel türünde API çağrısı yapmadan hata fırlatır', async () => {
    const create = jest.fn();
    const client = { messages: { create } } as unknown as AnthropicClientLike;
    const provider = new ClaudeVisionOcrProvider(client, fakeConfig());

    await expect(
      provider.transcribe({ base64: 'AAAA', mediaType: 'image/svg+xml' }),
    ).rejects.toThrow(/Desteklenmeyen görsel türü/);
    expect(create).not.toHaveBeenCalled();
  });

  it('yalnızca transkripsiyon ister, görseli sağlanan istemciye ham hâliyle iletir', async () => {
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Transkribe edilmiş metin.' }],
    });
    const client = { messages: { create } } as unknown as AnthropicClientLike;
    const provider = new ClaudeVisionOcrProvider(client, fakeConfig());

    const text = await provider.transcribe({ base64: 'BASE64DATA', mediaType: 'image/png' });

    expect(text).toBe('Transkribe edilmiş metin.');
    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0];
    expect(payload.messages[0].content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'BASE64DATA' },
    });
    // Sistem promptu analiz DEĞİL, yalnızca transkripsiyon istemeli.
    expect(payload.system).toMatch(/transkribe/i);
    expect(payload.system).not.toMatch(/riskLevel|deadlineToken/);
  });

  it('boş yanıt döndüğünde anlamlı hata fırlatır', async () => {
    const create = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: '   ' }] });
    const client = { messages: { create } } as unknown as AnthropicClientLike;
    const provider = new ClaudeVisionOcrProvider(client, fakeConfig());

    await expect(
      provider.transcribe({ base64: 'AAAA', mediaType: 'image/png' }),
    ).rejects.toThrow(/OCR/);
  });
});

describe('resolveOcrProviderKind', () => {
  const original = process.env.OCR_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.OCR_PROVIDER;
    else process.env.OCR_PROVIDER = original;
  });

  it('OCR_PROVIDER tanımsızsa varsayılan olarak "claude-vision" döner', () => {
    delete process.env.OCR_PROVIDER;
    expect(resolveOcrProviderKind()).toBe('claude-vision');
  });

  it('OCR_PROVIDER=local ise "local" döner', () => {
    process.env.OCR_PROVIDER = 'local';
    expect(resolveOcrProviderKind()).toBe('local');
  });
});

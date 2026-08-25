import { AppConfigService } from '../../config/config.service';
import {
  ClaudeVisionOcrProvider,
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
  /**
   * NOT: Bu test eskiden `tesseract.js`'in KURULU OLMAMASINA dayanıyordu
   * ("gerçek, mock'lanmamış senaryo"). Paket artık opsiyonel bağımlılık olarak
   * kurulu, dolayısıyla o varsayım geçersiz — eksiklik artık AÇIKÇA simüle
   * ediliyor. Aksi hâlde test, gerçek tesseract'ı 1 baytlık sahte görselle
   * çalıştırıp başka bir sebeple hata veriyor ve iddiasını doğrulamıyordu.
   */
  it('tesseract.js kurulu DEĞİLSE anlamlı ve eyleme geçirilebilir bir hata fırlatır', async () => {
    jest.resetModules();
    jest.doMock('tesseract.js', () => {
      throw new Error("Cannot find module 'tesseract.js'");
    });

    const { LocalOcrProvider: Fresh } = await import('./ocr.provider');
    await expect(
      new Fresh().transcribe({
        base64: Buffer.from('x').toString('base64'),
        mediaType: 'image/png',
      }),
    ).rejects.toThrow(/paketi kurulu değil/i);

    jest.dontMock('tesseract.js');
    jest.resetModules();
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

/**
 * D-044 regresyonu — ESM/CJS interop.
 *
 * `LocalOcrProvider`, `tesseract.js`'i lazy `import()` ile yükler. Derlenmiş
 * CJS'te (ÜRETİM imajı) namespace `{ OEM, PSM, createWorker, default }` olarak
 * gelir ve `recognize` YALNIZCA `default` altında bulunur; ts-node/ts-jest
 * altında ise namespace doğrudan çağrılabilir olabiliyor.
 *
 * Bu fark yüzünden kod yerelde çalışıp ÜRETİMDE `t.recognize is not a function`
 * ile patlıyordu — gerçek üretim imajının içinde çalıştırılarak bulundu.
 * D-034'ün birebir aynı deseni: mock'lu testler geçer, gerçek build kırılır.
 *
 * Bu testler her iki modül şeklini de zorlar.
 */
describe('LocalOcrProvider — tesseract.js modül şekli (D-044)', () => {
  const image = { base64: Buffer.from('sahte').toString('base64'), mediaType: 'image/jpeg' };

  afterEach(() => {
    jest.resetModules();
    jest.dontMock('tesseract.js');
  });

  it('CJS şekli: recognize YALNIZCA `default` altındayken çalışır', async () => {
    const recognize = jest.fn().mockResolvedValue({ data: { text: 'CJS yolu' } });
    jest.doMock('tesseract.js', () => ({
      // Üretimdeki gerçek şekil: recognize namespace'te YOK, `default` altında.
      // `__esModule: true` ŞART — aksi hâlde TypeScript'in `__importStar`
      // yardımcısı `default`'u modülün KENDİSİYLE ezer ve mock, simüle etmek
      // istediğimiz şekli temsil etmez.
      __esModule: true,
      OEM: {},
      PSM: {},
      createWorker: jest.fn(),
      default: { recognize },
    }));

    const { LocalOcrProvider: Fresh } = await import('./ocr.provider');
    await expect(new Fresh().transcribe(image as never)).resolves.toBe('CJS yolu');
    expect(recognize).toHaveBeenCalledTimes(1);
  });

  it('ESM şekli: recognize doğrudan namespace üzerindeyken de çalışır', async () => {
    const recognize = jest.fn().mockResolvedValue({ data: { text: 'ESM yolu' } });
    jest.doMock('tesseract.js', () => ({ recognize }));

    const { LocalOcrProvider: Fresh } = await import('./ocr.provider');
    await expect(new Fresh().transcribe(image as never)).resolves.toBe('ESM yolu');
    expect(recognize).toHaveBeenCalledTimes(1);
  });

  it('hiçbir şekilde recognize yoksa AÇIKLAYICI hata verir ("kurulu değil" DEĞİL)', async () => {
    jest.doMock('tesseract.js', () => ({ OEM: {}, PSM: {} }));

    const { LocalOcrProvider: Fresh } = await import('./ocr.provider');
    await expect(new Fresh().transcribe(image as never)).rejects.toThrow(
      /`recognize` bulunamadı/,
    );
  });
});

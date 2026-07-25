import { AppConfigService } from '../../config/config.service';
import { PiiService } from '../../common/pii/pii.service';
import { PiiEntityType } from '../../common/pii/pii.types';
import { LlmAnalysisResult } from '../../common/types/domain';
import { LlmService } from './llm.service';
import { AnthropicClientLike } from './anthropic-client';
import { OcrProvider } from './ocr.provider';
import { MOCK_MODEL_NAME } from './mock.llm';

/**
 * LlmService test seti (görev talimatı §"Testler").
 *
 * KRİTİK invaryant, her testin üstünde: bu dosya GERÇEK bir Claude API
 * çağrısı YAPMAZ. Gerçek `@anthropic-ai/sdk` istemcisi yerine her testte
 * `AnthropicClientLike` arayüzünü uygulayan sahte (fake) bir istemci enjekte
 * edilir — bu sayede API'ye giden payload'ı ağa çıkmadan denetleyebiliriz.
 */

function fakeConfig(
  overrides: Partial<{
    llmMock: boolean;
    anthropicApiKey: string | undefined;
    llmModel: string;
    llmMaxTokens: number;
  }> = {},
): AppConfigService {
  return {
    llmMock: overrides.llmMock ?? true,
    anthropicApiKey: overrides.anthropicApiKey,
    llmModel: overrides.llmModel ?? 'claude-sonnet-5',
    llmMaxTokens: overrides.llmMaxTokens ?? 2048,
  } as unknown as AppConfigService;
}

function fakeClient(create: jest.Mock = jest.fn()): jest.Mocked<AnthropicClientLike> {
  return { messages: { create } } as unknown as jest.Mocked<AnthropicClientLike>;
}

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

function fakeOcr(): jest.Mocked<OcrProvider> {
  return { transcribe: jest.fn() };
}

const VALID_ANALYSIS: LlmAnalysisResult = {
  authority: 'Ausländerbehörde Berlin',
  requestType: 'Unterlagennachforderung',
  summary: 'Test amaçlı geçerli bir özet.',
  deadlineToken: null,
  riskLevel: 'medium',
  missingDocuments: [],
  nextSteps: ['Adım 1'],
  confidence: 0.8,
  inScope: true,
};

const LETTER = [
  'Ausländerbehörde Berlin',
  'Herrn Ahmet Yılmaz',
  'Kolonnenstraße 12, 10827 Berlin',
  '',
  'Bitte reichen Sie die fehlenden Unterlagen bis zum 30.06.2024 ein.',
  'Kontakt: ahmet.yilmaz@example.com',
].join('\n');

const PROFILE = {
  fullName: 'Ahmet Yılmaz',
  address: 'Kolonnenstraße 12',
  email: 'ahmet.yilmaz@example.com',
};

describe('LlmService', () => {
  let pii: PiiService;

  beforeEach(() => {
    pii = new PiiService();
  });

  // ── Mock mod ───────────────────────────────────────────────────────────
  describe('mock modu (LLM_MOCK=true)', () => {
    it('geçerli bir LlmAnalysisResult döner ve gerçek API istemcisine dokunmaz', async () => {
      const create = jest.fn();
      const service = new LlmService(fakeClient(create), fakeOcr(), fakeConfig({ llmMock: true }), pii);

      const output = await service.analyzeDocument({ text: LETTER, profile: PROFILE });

      expect(output.model).toBe(MOCK_MODEL_NAME);
      expect(output.result.riskLevel).toBeDefined();
      expect(output.result.summary.length).toBeGreaterThan(0);
      expect(create).not.toHaveBeenCalled();
      // Maskeleme mock modda da uygulanır — ham isim maskedText'te bulunmaz.
      expect(output.maskedText).not.toContain('Ahmet Yılmaz');
    });

    it('maskeli girdideki DATE token\'larından birini deadlineToken yapar (D-009)', async () => {
      const service = new LlmService(fakeClient(), fakeOcr(), fakeConfig({ llmMock: true }), pii);

      const output = await service.analyzeDocument({ text: LETTER, profile: PROFILE });

      expect(output.result.deadlineToken).toMatch(/^\[\[DATE_\d+\]\]$/);
      // Token, gerçek maskeli metinde de var olmalı (uydurma olmamalı).
      expect(output.maskedText).toContain(output.result.deadlineToken as string);
    });

    it('image girdisiyle çağrıldığında OCR sağlayıcısını hiç kullanmaz (mock OCR metni kullanılır)', async () => {
      const ocr = fakeOcr();
      const service = new LlmService(fakeClient(), ocr, fakeConfig({ llmMock: true }), pii);

      const output = await service.analyzeDocument({
        image: { base64: 'AAAA', mediaType: 'image/png' },
      });

      expect(ocr.transcribe).not.toHaveBeenCalled();
      expect(output.result).toBeDefined();
    });
  });

  // ── Maskeleme zorunluluğu ────────────────────────────────────────────────
  describe('maskeleme zorunluluğu', () => {
    it("API'ye giden payload'da ham PII BULUNMAZ", async () => {
      const create = jest.fn().mockResolvedValue(textResponse(JSON.stringify(VALID_ANALYSIS)));
      const service = new LlmService(
        fakeClient(create),
        fakeOcr(),
        fakeConfig({ llmMock: false, anthropicApiKey: 'test-key' }),
        pii,
      );

      await service.analyzeDocument({ text: LETTER, profile: PROFILE });

      expect(create).toHaveBeenCalledTimes(1);
      const payload = create.mock.calls[0][0];
      const serialized = JSON.stringify(payload);

      for (const secret of [
        'Ahmet Yılmaz',
        'Kolonnenstraße 12',
        'ahmet.yilmaz@example.com',
        '30.06.2024',
      ]) {
        expect(serialized).not.toContain(secret);
      }
      // Yer tutucular gerçekten payload'a ulaşmış olmalı (maskeleme sessizce
      // metni boşaltmamış).
      expect(serialized).toMatch(/\[\[NAME_\d+\]\]/);
    });

    it('generateDraft de ham PII göndermez', async () => {
      const create = jest.fn().mockResolvedValue(
        textResponse(JSON.stringify({ subject: 'Konu', body: 'Gövde', placeholders: [] })),
      );
      const service = new LlmService(
        fakeClient(create),
        fakeOcr(),
        fakeConfig({ llmMock: false, anthropicApiKey: 'test-key' }),
        pii,
      );
      const { maskedText, map } = pii.mask(LETTER, { profile: PROFILE });

      await service.generateDraft({ analysis: VALID_ANALYSIS, maskedContext: maskedText, map });

      const serialized = JSON.stringify(create.mock.calls[0][0]);
      expect(serialized).not.toContain('Ahmet Yılmaz');
      expect(serialized).not.toContain('ahmet.yilmaz@example.com');
    });
  });

  // ── Fail-closed sızıntı kontrolü ─────────────────────────────────────────
  describe('fail-closed sızıntı kontrolü', () => {
    it('detectLeaks sızıntı bulursa API çağrısı ENGELLENİR', async () => {
      const create = jest.fn();
      const service = new LlmService(
        fakeClient(create),
        fakeOcr(),
        fakeConfig({ llmMock: false, anthropicApiKey: 'test-key' }),
        pii,
      );

      // Gerçek sızıntı senaryosunu simüle etmek için detectLeaks'i spy'lıyoruz.
      jest.spyOn(pii, 'detectLeaks').mockReturnValue([PiiEntityType.NAME]);

      await expect(
        service.analyzeDocument({ text: LETTER, profile: PROFILE }),
      ).rejects.toThrow(/sızıntı/i);
      expect(create).not.toHaveBeenCalled();
    });

    it('sızıntı yoksa çağrı normal şekilde ilerler', async () => {
      const create = jest.fn().mockResolvedValue(textResponse(JSON.stringify(VALID_ANALYSIS)));
      const service = new LlmService(
        fakeClient(create),
        fakeOcr(),
        fakeConfig({ llmMock: false, anthropicApiKey: 'test-key' }),
        pii,
      );

      jest.spyOn(pii, 'detectLeaks').mockReturnValue([]);

      await expect(
        service.analyzeDocument({ text: LETTER, profile: PROFILE }),
      ).resolves.toBeDefined();
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  // ── Zod doğrulaması ───────────────────────────────────────────────────────
  describe('Zod doğrulaması', () => {
    it('bozuk JSON reddedilir; düzeltme denemesi de başarısızsa anlamlı hata fırlatılır', async () => {
      const create = jest
        .fn()
        .mockResolvedValueOnce(textResponse('bu geçerli bir JSON değil'))
        .mockResolvedValueOnce(textResponse('{"foo": "bar"}')); // şemaya uymuyor

      const service = new LlmService(
        fakeClient(create),
        fakeOcr(),
        fakeConfig({ llmMock: false, anthropicApiKey: 'test-key' }),
        pii,
      );

      await expect(
        service.analyzeDocument({ text: LETTER, profile: PROFILE }),
      ).rejects.toThrow(/şema/i);
      // 1 orijinal deneme + 1 düzeltme denemesi = 2 çağrı.
      expect(create).toHaveBeenCalledTimes(2);
    });

    it('ilk deneme geçersiz ama düzeltme sonrası geçerliyse başarıyla sonuç döner', async () => {
      const create = jest
        .fn()
        .mockResolvedValueOnce(textResponse('geçersiz yanıt'))
        .mockResolvedValueOnce(textResponse(JSON.stringify(VALID_ANALYSIS)));

      const service = new LlmService(
        fakeClient(create),
        fakeOcr(),
        fakeConfig({ llmMock: false, anthropicApiKey: 'test-key' }),
        pii,
      );

      const output = await service.analyzeDocument({ text: LETTER, profile: PROFILE });

      expect(output.result.riskLevel).toBe(VALID_ANALYSIS.riskLevel);
      expect(create).toHaveBeenCalledTimes(2);
    });

    it('```json kod bloğuna sarılmış geçerli yanıtı da doğru ayıklar', async () => {
      const create = jest
        .fn()
        .mockResolvedValueOnce(textResponse('```json\n' + JSON.stringify(VALID_ANALYSIS) + '\n```'));

      const service = new LlmService(
        fakeClient(create),
        fakeOcr(),
        fakeConfig({ llmMock: false, anthropicApiKey: 'test-key' }),
        pii,
      );

      const output = await service.analyzeDocument({ text: LETTER, profile: PROFILE });
      expect(output.result.authority).toBe(VALID_ANALYSIS.authority);
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  // ── generateDraft ─────────────────────────────────────────────────────────
  describe('generateDraft', () => {
    it("token'lı bağlamla çalışır (mock modda)", async () => {
      const create = jest.fn();
      const service = new LlmService(fakeClient(create), fakeOcr(), fakeConfig({ llmMock: true }), pii);

      const analyzeOutput = await service.analyzeDocument({ text: LETTER, profile: PROFILE });
      const draftOutput = await service.generateDraft({
        analysis: analyzeOutput.result,
        maskedContext: analyzeOutput.maskedText,
        map: analyzeOutput.map,
      });

      expect(draftOutput.result.subject).toBeTruthy();
      expect(draftOutput.result.body).toBeTruthy();
      expect(draftOutput.model).toBe(MOCK_MODEL_NAME);
      expect(create).not.toHaveBeenCalled();
    });

    it('userProfileHints ile de çalışır', async () => {
      const service = new LlmService(fakeClient(), fakeOcr(), fakeConfig({ llmMock: true }), pii);
      const { maskedText, map } = pii.mask(LETTER, { profile: PROFILE });

      const draftOutput = await service.generateDraft({
        analysis: VALID_ANALYSIS,
        maskedContext: maskedText,
        map,
        userProfileHints: { visaType: 'Aufenthaltserlaubnis', familyStatus: 'evli' },
      });

      expect(draftOutput.result.body).toBeTruthy();
    });
  });

  // ── unmask round-trip ─────────────────────────────────────────────────────
  describe('unmask sonrası gerçek PII', () => {
    it('LLM sonucu unmaskDeep ile çözüldüğünde gerçek PII değerini içerir', async () => {
      const service = new LlmService(fakeClient(), fakeOcr(), fakeConfig({ llmMock: true }), pii);

      const output = await service.analyzeDocument({ text: LETTER, profile: PROFILE });
      expect(output.result.summary).toMatch(/\[\[NAME_\d+\]\]/);

      const unmasked = pii.unmaskDeep(output.result, output.map);

      expect(unmasked.summary).toContain('Ahmet Yılmaz');
      expect(unmasked.summary).not.toMatch(/\[\[/);
    });
  });

  // ── Hata durumları ────────────────────────────────────────────────────────
  describe('hata durumları', () => {
    it('mock kapalıyken API anahtarı yoksa anlamlı bir hata fırlatır', async () => {
      const create = jest.fn().mockRejectedValue(
        new Error(
          'ANTHROPIC_API_KEY tanımlı değil ve LLM_MOCK=false. Gerçek Claude API çağrısı yapılamaz.',
        ),
      );
      const service = new LlmService(
        fakeClient(create),
        fakeOcr(),
        fakeConfig({ llmMock: false, anthropicApiKey: undefined }),
        pii,
      );

      await expect(
        service.analyzeDocument({ text: LETTER, profile: PROFILE }),
      ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    });

    it('ne text ne image verilmezse anlamlı hata fırlatır', async () => {
      const service = new LlmService(fakeClient(), fakeOcr(), fakeConfig({ llmMock: true }), pii);
      await expect(service.analyzeDocument({})).rejects.toThrow(/text.*image/i);
    });
  });
});

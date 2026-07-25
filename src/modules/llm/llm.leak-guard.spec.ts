import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { LlmService } from './llm.service';
import { AnthropicClientLike } from './anthropic-client';
import { OcrProvider } from './ocr.provider';
import { PiiService } from '../../common/pii/pii.service';
import { AppConfigService } from '../../config/config.service';
import { KnownPiiProfile } from '../../common/pii/pii.types';

/**
 * Bağımsız sızıntı denetimi (CLAUDE.md §10 — Definition of Done).
 *
 * Bu dosya, LLM modülünün KENDİ testlerinden AYRI olarak ana oturum tarafından
 * yazıldı. Amaç, "PII maskeleme katmanı test edilmiş ve LLM'e giden veride ham
 * kimlik bilgisi bulunmadığı doğrulanmış" kriterini, modülün kendi varsayımlarına
 * güvenmeden, GERÇEK fixture mektuplarıyla kanıtlamak.
 *
 * Yöntem: sahte bir Anthropic istemcisi enjekte edilir; `messages.create`'e
 * ulaşan payload'ın TAMAMI yakalanır ve içinde fixture profilindeki ham PII
 * değerlerinin hiçbirinin geçmediği doğrulanır.
 */

const FIXTURE_DIR = join(__dirname, '../../../test-fixtures');
const LETTER_DIR = join(FIXTURE_DIR, 'behordenbriefe');

const expected: Record<string, { file: string }> = JSON.parse(
  readFileSync(join(LETTER_DIR, 'expected.json'), 'utf8'),
);
const profiles: Record<string, KnownPiiProfile> = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'profiles.json'), 'utf8'),
);

const letterKeys = Object.keys(expected);

/** Gönderilen her payload'ı biriktiren sahte istemci. */
function makeSpyClient(responseText: string) {
  const payloads: string[] = [];

  const client: AnthropicClientLike = {
    messages: {
      create: async (body: Anthropic.MessageCreateParamsNonStreaming) => {
        // Sistem promptu + tüm mesajlar dâhil, giden her şeyi kaydet.
        payloads.push(JSON.stringify(body));
        return {
          content: [{ type: 'text', text: responseText }],
          model: 'test-model',
        } as unknown as Anthropic.Message;
      },
    },
  };

  return { client, payloads };
}

const VALID_ANALYSIS_JSON = JSON.stringify({
  authority: 'Ausländerbehörde',
  requestType: 'Unterlagennachforderung',
  summary: 'Zusammenfassung für [[NAME_1]].',
  deadlineToken: '[[DATE_1]]',
  riskLevel: 'high',
  missingDocuments: [{ label: 'Mietvertrag', required: true }],
  nextSteps: ['Unterlagen einreichen'],
  confidence: 0.9,
  inScope: true,
});

function makeConfig(): AppConfigService {
  return {
    llmMock: false, // gerçek çağrı yolunu zorla (sahte istemciyle)
    llmModel: 'claude-sonnet-5',
    llmMaxTokens: 2048,
    ocrProvider: 'claude-vision',
    isProduction: false,
  } as AppConfigService;
}

/** OCR hiç çağrılmamalı (metin girdisi veriyoruz) — çağrılırsa test patlasın. */
const failingOcr: OcrProvider = {
  kind: 'claude-vision',
  extractText: async () => {
    throw new Error('Bu testte OCR çağrılmamalıydı.');
  },
} as unknown as OcrProvider;

describe('LlmService — bağımsız sızıntı denetimi (gerçek fixture mektuplarıyla)', () => {
  describe.each(letterKeys)('%s', (key) => {
    it('API payload\'ında kullanıcının hiçbir ham PII değeri bulunmaz', async () => {
      const text = readFileSync(join(LETTER_DIR, expected[key].file), 'utf8');
      const profile = profiles[key];

      const { client, payloads } = makeSpyClient(VALID_ANALYSIS_JSON);
      const service = new LlmService(
        client,
        failingOcr,
        makeConfig(),
        new PiiService(),
      );

      await service.analyzeDocument({ text, profile });

      expect(payloads.length).toBeGreaterThan(0);
      const sent = payloads.join('\n');

      // Profildeki her hassas değer payload'da GEÇMEMELİ.
      const secrets = [
        profile.fullName,
        profile.familyName,
        profile.givenName,
        profile.address,
        profile.email,
        profile.phone,
        profile.dateOfBirth,
        profile.auslaendernummer,
        profile.steuerId,
        profile.passportNumber,
        profile.insuranceNumber,
      ].filter((v): v is string => typeof v === 'string' && v.length > 3);

      expect(secrets.length).toBeGreaterThan(0); // profil gerçekten dolu mu

      for (const secret of secrets) {
        expect(sent).not.toContain(secret);
      }
    });

    it('payload maskeli token\'lar içerir (maskeleme gerçekten uygulanmış)', async () => {
      const text = readFileSync(join(LETTER_DIR, expected[key].file), 'utf8');
      const { client, payloads } = makeSpyClient(VALID_ANALYSIS_JSON);
      const service = new LlmService(
        client,
        failingOcr,
        makeConfig(),
        new PiiService(),
      );

      await service.analyzeDocument({ text, profile: profiles[key] });

      expect(payloads.join('\n')).toMatch(/\[\[[A-Z]+_\d+\]\]/);
    });
  });

  describe('fail-closed davranışı', () => {
    it('maskeleme başarısız olsaydı çağrı YAPILMAZDI (sızıntı → hata)', async () => {
      // PiiService'i, maskelemeyi kasıtlı olarak "unutan" bir sahteyle değiştiriyoruz:
      // mask() metni olduğu gibi döndürüyor ama map dolu — yani sızıntı var.
      const realPii = new PiiService();
      const leakyPii = {
        mask: (t: string, o?: unknown) => {
          const real = realPii.mask(t, o as never);
          return { maskedText: t, map: real.map, count: real.count };
        },
        detectLeaks: realPii.detectLeaks.bind(realPii),
        unmask: realPii.unmask.bind(realPii),
        unmaskDeep: realPii.unmaskDeep.bind(realPii),
      } as unknown as PiiService;

      const { client, payloads } = makeSpyClient(VALID_ANALYSIS_JSON);
      const service = new LlmService(
        client,
        failingOcr,
        makeConfig(),
        leakyPii,
      );

      const text = readFileSync(
        join(LETTER_DIR, expected[letterKeys[0]].file),
        'utf8',
      );

      await expect(
        service.analyzeDocument({ text, profile: profiles[letterKeys[0]] }),
      ).rejects.toThrow();

      // En kritik iddia: hiçbir şey gönderilmemiş olmalı.
      expect(payloads).toHaveLength(0);
    });
  });
});

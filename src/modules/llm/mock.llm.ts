import { LlmAnalysisResult, LlmDraftResult } from '../../common/types/domain';

/** Mock modda `model` alanına yazılan sabit ad — gerçek Claude model ID'siyle asla karışmasın. */
export const MOCK_MODEL_NAME = 'mock-llm-deterministic';

/**
 * `LLM_MOCK=true` iken kullanılan deterministik sahte yanıt üretici.
 *
 * Amaç: API anahtarı olmadan geliştirme/test yapılabilmesi (CLAUDE.md §1,
 * §7 — "geçici bir mock/stub arkasında geliştirmeye devam et"). Girdiye göre
 * DETERMİNİSTİK sonuç üretir; aynı girdi her zaman aynı çıktıyı verir —
 * testler ve geliştirme akışı buna dayanır. Gerçek Claude API'sine ASLA
 * çıkmaz (bkz. `LlmService` — mock kontrolü her public metodun en başında).
 */
export class MockLlm {
  /**
   * Maskeli metindeki ilk `[[DATE_n]]` token'ını (varsa) deadline olarak
   * seçer — görev talimatı: "maskeli girdideki DATE token'larından birini
   * deadlineToken yap".
   */
  static analyze(maskedText: string): LlmAnalysisResult {
    const dateToken = MockLlm.firstToken(maskedText, 'DATE');
    const nameToken = MockLlm.firstToken(maskedText, 'NAME');

    return {
      authority: 'Ausländerbehörde (mock)',
      requestType: 'Unterlagennachforderung (mock)',
      summary:
        `[MOCK] ${nameToken ?? 'İlgili kişi'} adına gönderilen bu belge, eksik ` +
        'evrakların tamamlanmasını talep ediyor. Bu bir mock analizdir; gerçek ' +
        'analiz için LLM_MOCK=false ve geçerli bir ANTHROPIC_API_KEY gerekir.',
      deadlineToken: dateToken,
      riskLevel: dateToken ? 'medium' : 'low',
      missingDocuments: [
        {
          label: 'Aktueller Mietvertrag',
          explanation: 'Güncel kira sözleşmesi fotokopisi (mock)',
          whereToGet: 'Ev sahibinizden veya emlakçınızdan',
          required: true,
        },
        {
          label: 'Einkommensnachweis',
          explanation: 'Son 3 aya ait gelir belgesi (mock)',
          whereToGet: 'İşvereninizden',
          required: true,
        },
      ],
      nextSteps: [
        '[MOCK] Eksik belgeleri yukarıdaki listeden kontrol edin.',
        '[MOCK] Belirtilen son tarihten önce kuruma iletin.',
      ],
      confidence: 0.42,
      inScope: true,
    };
  }

  static draft(input: {
    analysis: LlmAnalysisResult;
    maskedContext: string;
    userProfileHints?: { visaType?: string; familyStatus?: string };
  }): LlmDraftResult {
    const nameToken = MockLlm.firstToken(input.maskedContext, 'NAME');
    const subjectSuffix = input.analysis.requestType ?? 'Antwort';

    return {
      subject: `[MOCK] ${subjectSuffix} - Stellungnahme`,
      body: [
        'Sehr geehrte Damen und Herren,',
        '',
        '[MOCK TASLAK] hiermit Bezug nehmend auf Ihr Schreiben' +
          (nameToken ? ` bezüglich ${nameToken}` : '') +
          ', übersende ich Ihnen die angeforderten Unterlagen fristgerecht.',
        '',
        'Mit freundlichen Grüßen',
      ].join('\n'),
      placeholders: [
        '[MOCK] Bu bir örnek taslaktır — kuruma göndermeden önce mutlaka gözden geçirin ve onaylayın.',
        '[MOCK] Ekleyeceğiniz belgeleri mektuba iliştirmeyi unutmayın.',
      ],
    };
  }

  /** Mock modda OCR adımı için deterministik, sentetik bir Behördenbrief metni. */
  static ocrText(): string {
    return [
      'Ausländerbehörde Berlin',
      'Friedrich-Krause-Ufer 24, 13353 Berlin',
      '',
      'Herrn [MOCK NAME]',
      '[MOCK ADDRESS]',
      '',
      'Aktenzeichen: MOCK-0000-0001',
      '',
      'Sehr geehrte Damen und Herren,',
      '',
      'im Rahmen Ihres Antrags auf Verlängerung der Aufenthaltserlaubnis benötigen ' +
        'wir weitere Unterlagen. Bitte reichen Sie diese bis zum 31.12.2099 ein.',
      '',
      'Mit freundlichen Grüßen',
    ].join('\n');
  }

  private static firstToken(text: string, type: string): string | null {
    const match = text.match(new RegExp(`\\[\\[${type}_\\d+\\]\\]`));
    return match ? match[0] : null;
  }
}

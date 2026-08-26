process.env.NODE_ENV = 'test';
process.env.LLM_MOCK = 'true';
process.env.DB_DRIVER = 'memory';
process.env.TELEGRAM_MODE = 'disabled';

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../../app.module';
import { ConversationModule } from '../../conversation/conversation.module';
import { ChannelAdapter } from '../channel.adapter';
import { AppConfigService } from '../../../config/config.service';
import { TelegramService } from './telegram.service';
import { TelegramAdapter } from './telegram.adapter';

/**
 * D-055 — canlı üretimde bulundu: bir kullanıcı gerçek bir /start mesajı
 * gönderdi ve AI şeffaflık açıklamasını İKİ KEZ, birebir aynı metinle aldı.
 *
 * Kök neden: `TelegramService.dispatch()` /start'ta kendi başına
 * aiDisclosureText gönderiyordu ("kanal seviyesinde garanti" — yorum satırında
 * öyle deniyordu), `ConversationService.handleCommand('start')` ise AYRICA
 * aynı mesajı kendisi gönderiyordu. İkisi de kendi biriminde ayrı ayrı
 * "doğru" görünüyordu (telegram.service.spec.ts sahte bir handler'la,
 * conversation.service.spec.ts sahte bir adapter'la test ediyordu) — hiçbiri
 * gerçek uçtan uca TAM zinciri (TelegramService → TelegramAdapter →
 * ConversationService) kurup mesaj SAYISINI doğrulamıyordu.
 *
 * Bu test tam olarak o zinciri kurar: gerçek TelegramService + gerçek
 * TelegramAdapter, ConversationService'in `ChannelAdapter`'ı olarak DI'a
 * bağlanır (yalnızca grammY Bot'un ağ çağrısı yapan `api.sendMessage`'ı sahte).
 */
describe('AI şeffaflığı (D-055) — TelegramService → TelegramAdapter → ConversationService tam zinciri', () => {
  let app: INestApplication;
  let sendMessage: jest.Mock;
  let telegramService: TelegramService;

  const ORIGINAL_ENV = process.env;

  beforeEach(async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      LLM_MOCK: 'true',
      DB_DRIVER: 'memory',
      TELEGRAM_MODE: 'disabled',
    };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PII_MASTER_KEY;

    telegramService = new TelegramService({
      telegramMode: 'disabled',
      telegramBotToken: undefined,
    } as unknown as AppConfigService);
    sendMessage = jest.fn().mockResolvedValue(undefined);
    (telegramService as unknown as { bot: unknown }).bot = { api: { sendMessage } };
    (telegramService as unknown as { running: boolean }).running = true;

    const telegramAdapter = new TelegramAdapter(telegramService);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ConversationModule],
    })
      .overrideProvider(ChannelAdapter)
      .useValue(telegramAdapter)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init(); // ConversationService.onModuleInit → channel.onMessage → telegramService.registerHandler
  });

  afterEach(async () => {
    await app?.close();
    process.env = ORIGINAL_ENV;
  });

  it('/start tam zincirden geçtiğinde AI şeffaflık mesajı TAM OLARAK BİR KEZ gönderilir', async () => {
    await telegramService.dispatch({
      message: { chat: { id: 555 }, from: { id: 555, language_code: 'tr' }, text: '/start' },
    });

    const disclosureCalls = sendMessage.mock.calls.filter(([, text]: [string, string]) =>
      /HUKUKİ TAVSİYE|hukuki tavsiye/i.test(text),
    );
    expect(disclosureCalls).toHaveLength(1);

    // Tam akış: şeffaflık + karşılama + onay isteği — üçü de tam bir kez.
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('ikinci bir /start (yeni oturum) yine yalnızca bir kez şeffaflık mesajı gönderir', async () => {
    await telegramService.dispatch({
      message: { chat: { id: 556 }, from: { id: 556, language_code: 'tr' }, text: '/start' },
    });
    sendMessage.mockClear();

    await telegramService.dispatch({
      message: { chat: { id: 556 }, from: { id: 556, language_code: 'tr' }, text: '/start' },
    });

    const disclosureCalls = sendMessage.mock.calls.filter(([, text]: [string, string]) =>
      /HUKUKİ TAVSİYE|hukuki tavsiye/i.test(text),
    );
    expect(disclosureCalls).toHaveLength(1);
  });
});

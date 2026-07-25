import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { PiiService } from './common/pii/pii.service';
import { CryptoService } from './common/crypto/crypto.service';
import { AppConfigService } from './config/config.service';
import { LlmService } from './modules/llm/llm.service';
import { ChannelAdapter } from './modules/channels/channel.adapter';
import { UserRepository } from './modules/persistence/repositories/user.repository';
import { DraftRepository } from './modules/persistence/repositories/draft.repository';

/**
 * Bootstrap/DI bütünlük testi.
 *
 * Amaç: modüller ayrı ayrı yeşil olsa bile, birleştirildiklerinde DI grafiği
 * çözülemeyebilir (eksik export, döngüsel bağımlılık, yanlış token). Bu test
 * uygulamanın GERÇEKTEN ayağa kalkabildiğini doğrular ve gerçek anahtar
 * olmadan (mock modda) çalıştığını garanti eder — MANUAL_ACTIONS_REQUIRED.md'nin
 * "hepsi mock/stub arkasında çalışıyor" iddiasının kanıtı.
 */
describe('AppModule — DI bütünlüğü', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Anahtarsız, mock, in-memory varsayılan yapılandırma.
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      LLM_MOCK: 'true',
      DB_DRIVER: 'memory',
      TELEGRAM_MODE: 'disabled',
    };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.SUPABASE_URL;
    delete process.env.PII_MASTER_KEY;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('hiçbir gerçek API anahtarı olmadan tüm modüller yüklenir', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    // Kritik servislerin tümü çözülebilmeli.
    expect(app.get(AppConfigService)).toBeDefined();
    expect(app.get(PiiService)).toBeInstanceOf(PiiService);
    expect(app.get(CryptoService)).toBeInstanceOf(CryptoService);
    expect(app.get(LlmService)).toBeInstanceOf(LlmService);
    expect(app.get(ChannelAdapter)).toBeDefined();
    expect(app.get(UserRepository)).toBeDefined();
    expect(app.get(DraftRepository)).toBeDefined();

    await app.close();
  });

  it('mock modda uçtan uca bir analiz çağrısı çalışır (anahtarsız)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const llm = app.get(LlmService);
    const out = await llm.analyzeDocument({
      text: 'Sehr geehrter Herr Yılmaz, bitte reichen Sie bis zum 30.06.2024 ein.',
      profile: { fullName: 'Ahmet Yılmaz' },
    });

    expect(out.result).toBeDefined();
    expect(out.maskedText).not.toContain('Yılmaz');
    expect(out.map.matches.length).toBeGreaterThan(0);

    await app.close();
  });

  it('repository yazma/okuma in-memory sürücüyle çalışır', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const users = app.get(UserRepository);
    const created = await users.create({
      channel: 'telegram',
      channelUserId: '12345',
      locale: 'tr',
    });

    expect(created.id).toBeTruthy();
    expect(await users.findByChannel('telegram', '12345')).toMatchObject({
      id: created.id,
    });

    await app.close();
  });
});

import { AppConfigService } from '../../config/config.service';
import { bootAppWithConfig } from './boot-with-config';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Test altyapısının KENDİ testleri (D-049)
 *
 * Bu suite ürün kodunu değil, **testlerin dayandığı zemini** doğrular.
 *
 *   1. HERMETİKLİK — testler yerel `.env`'den etkilenmez (D-032). Bu garanti
 *      bugüne kadar Jest'in ÖRTÜK `NODE_ENV=test` varsayılanına dayanıyordu;
 *      repoda garanti eden hiçbir şey yoktu. Ölçüldü: `NODE_ENV=development
 *      npx jest` ile config `.env`'i okumaya başlıyor ve `telegramMode`
 *      `disabled` yerine `polling` geliyor. Sonuç: gerçek ANTHROPIC anahtarıyla
 *      ÜCRETLİ API çağrısı ve gerçek bot başlatma riski (ikisi de bu projede
 *      daha önce yaşandı — D-032, D-043). `jest.setup.ts` artık açıkça sabitler.
 *
 *   2. TUZAK SABİTLENDİ — test GÖVDESİNDE `process.env` değiştirmek ETKİSİZDİR.
 *      Bu davranış burada bilerek teste bağlanıyor: bir gün `ConfigModule`
 *      tembel okumaya geçerse test kırılır ve tuzağın kalktığını haber verir.
 *
 * Bu dosya olmadan iki garanti de "öyle sandığımız" şeyler olurdu. Bu projede
 * doğrulama aracının kendisi dört kez yanıldı.
 * ════════════════════════════════════════════════════════════════════════════
 */
describe('Test altyapısı (D-049)', () => {
  describe('hermetiklik: yerel .env testlere SIZMAZ', () => {
    it('NODE_ENV "test" — ignoreEnvFile koşulunun dayandığı tek şey', () => {
      expect(process.env.NODE_ENV).toBe('test');
    });

    it('taban değerler şema varsayılanlarıyla aynı', () => {
      // `.env` sızsaydı bunlar geliştiricinin yerel değerleri olurdu
      // (bu makinede: TELEGRAM_MODE=polling).
      expect(process.env.LLM_MOCK).toBe('true');
      expect(process.env.DB_DRIVER).toBe('memory');
      expect(process.env.TELEGRAM_MODE).toBe('disabled');
    });

    it('gerçek uygulama boot\'unda da .env değerleri görünmez', async () => {
      const ctx = await bootAppWithConfig();
      try {
        const config = ctx.app.get(AppConfigService);
        expect(config.telegramMode).toBe('disabled');
        expect(config.dbDriver).toBe('memory');
        expect(config.llmMock).toBe(true);
      } finally {
        await ctx.close();
      }
    });
  });

  describe('bilinen tuzak: test gövdesinde env değiştirmek ETKİSİZ', () => {
    it('process.env ataması config\'e YANSIMAZ (davranış sabitlendi)', async () => {
      // Bu testin "geçmesi" tuzağın HÂLÂ VAR olduğunu gösterir. Kırılırsa
      // ConfigModule tembel okumaya geçmiş demektir — o zaman bu dosya ve
      // boot-with-config.ts gözden geçirilmeli.
      const before = process.env.SCHEDULER_SKIP_STARTUP;
      process.env.SCHEDULER_SKIP_STARTUP = 'true';
      try {
        const ctx = await bootAppWithConfig();
        try {
          expect(ctx.app.get(AppConfigService).schedulerSkipStartup).toBe(false);
        } finally {
          await ctx.close();
        }
      } finally {
        if (before === undefined) delete process.env.SCHEDULER_SKIP_STARTUP;
        else process.env.SCHEDULER_SKIP_STARTUP = before;
      }
    });
  });

  describe('doğru yol: bootAppWithConfig ile override', () => {
    it('varsayılanı false olan bayrak GERÇEKTEN true olur', async () => {
      const ctx = await bootAppWithConfig({ schedulerSkipStartup: true });
      try {
        expect(ctx.app.get(AppConfigService).schedulerSkipStartup).toBe(true);
      } finally {
        await ctx.close();
      }
    });

    it('override sonraki boot\'a SIZMAZ (testler birbirini kirletmez)', async () => {
      const a = await bootAppWithConfig({ schedulerSkipStartup: true });
      expect(a.app.get(AppConfigService).schedulerSkipStartup).toBe(true);
      await a.close();

      const b = await bootAppWithConfig();
      try {
        expect(b.app.get(AppConfigService).schedulerSkipStartup).toBe(false);
      } finally {
        await b.close();
      }
    });

    it('override, onModuleInit kancalarından ÖNCE uygulanır', async () => {
      // `init()` override'lardan sonra çağrılır; aksi hâlde açılış kancaları
      // eski değeri görür ve yardımcı sessizce yanlış davranırdı.
      const ctx = await bootAppWithConfig({ telegramMode: 'disabled' });
      try {
        expect(ctx.app.get(AppConfigService).telegramMode).toBe('disabled');
      } finally {
        await ctx.close();
      }
    });
  });
});

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { AppConfigService } from '../../config/config.service';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Test yardımcısı: config'i GERÇEKTEN değiştirerek AppModule boot'u (D-049)
 *
 * ── Kapatılan tuzak ─────────────────────────────────────────────────────────
 * `ConfigModule.forRoot()` doğrulamayı **import anında** çalıştırır. Bu yüzden
 * en yaygın desen SESSİZCE ETKİSİZDİR:
 *
 *     import { AppModule } from '../../app.module';   // ← env burada okundu
 *     beforeEach(() => { process.env.X = 'true'; });  // ← ÇOK GEÇ
 *
 * Ölçüldü: `SCHEDULER_SKIP_STARTUP='true'` atandıktan sonra boot edilen
 * uygulamada `ConfigService.get(...)` hâlâ `false` dönüyordu. Test "geçiyor"
 * ama iddia ettiği şeyi doğrulamıyordu. Bugüne kadar zarar vermemesinin tek
 * sebebi, spec'lerin kurduğu değerlerin zaten şema varsayılanlarıyla aynı
 * olmasıydı (`memory`, `true`, `disabled`).
 *
 * ── Neden `jest.resetModules()` + dinamik import DEĞİL ──────────────────────
 * İlk denenen çözüm buydu ve ÇALIŞMADI: `resetModules()` sonrası tepede statik
 * import edilmiş `AppConfigService`, yeniden yüklenen modül grafiğindekinden
 * FARKLI bir sınıf nesnesi olur ve `app.get(AppConfigService)` "provider does
 * not exist" ile düşer. Ölçüldü, bu yüzden terk edildi.
 *
 * ── Yaklaşım ────────────────────────────────────────────────────────────────
 * Env'i hiç kurcalamadan, boot edilmiş `AppConfigService` örneğinin ilgili
 * getter'ları örnek düzeyinde gölgelenir. Override'lar `app.init()`'ten ÖNCE
 * uygulanır ki `onModuleInit` kancaları da doğru değeri görsün.
 *
 * ── Kullanım ────────────────────────────────────────────────────────────────
 *     const ctx = await bootAppWithConfig({ schedulerSkipStartup: true });
 *     try { ... } finally { await ctx.close(); }
 *
 * Daha ucuz alternatif: servisi doğrudan sahte config ile kurmak — D-043/D-047
 * guard testlerinin yaptığı budur ve tam boot gerekmediğinde tercih edilmeli.
 * ════════════════════════════════════════════════════════════════════════════
 */

export interface BootedApp {
  app: INestApplication;
  close: () => Promise<void>;
}

export async function bootAppWithConfig(
  overrides: Partial<Record<keyof AppConfigService, unknown>> = {},
): Promise<BootedApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();

  // `compile()` sonrası örnekler hazırdır; `init()` henüz çalışmadığı için
  // `onModuleInit` kancaları override'ları görecek.
  const config = app.get(AppConfigService);
  for (const [key, value] of Object.entries(overrides)) {
    // Getter'lar prototipte tanımlı; örnek üzerinde kendi özelliğini tanımlamak
    // onları gölgeler. `configurable: true` — aynı örnek yeniden düzenlenebilsin.
    Object.defineProperty(config, key, {
      value,
      configurable: true,
      enumerable: true,
    });
  }

  await app.init();
  return { app, close: () => app.close() };
}

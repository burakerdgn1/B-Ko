import { Injectable, Logger } from '@nestjs/common';
import type { Browser } from 'playwright';

/**
 * Tek bir randevu sayfası kontrolünün sonucu.
 */
export interface AppointmentCheckResult {
  available: boolean;
  slots: string[];
  checkedAt: Date;
}

/**
 * Playwright tarayıcısı çalışma zamanında kullanılamadığında fırlatılır.
 *
 * `playwright` paketi `package.json`'da `optionalDependencies`'te — kurulu
 * olmayabilir (paket) ya da kurulu olup `playwright install` hiç
 * çalıştırılmamış olabilir (tarayıcı ikili dosyaları eksik). Her iki durumda
 * da uygulama ÇÖKMEMELİ: bu hata WatcherService tarafından yakalanıp ilgili
 * `AppointmentWatch` kaydı `status: 'error'` yapılır, diğer izlemeler
 * etkilenmeden devam eder.
 */
export class PlaywrightNotAvailableError extends Error {
  constructor(cause?: unknown) {
    const detail = cause instanceof Error ? ` Ayrıntı: ${cause.message}` : '';
    super(
      'Playwright tarayıcısı kullanılamıyor. Kurulum için ana dizinde ' +
        '`npx playwright install chromium` çalıştırın ' +
        '(bkz. MANUAL_ACTIONS_REQUIRED.md).' +
        detail,
    );
    this.name = 'PlaywrightNotAvailableError';
  }
}

/**
 * Mock sayfaların (`test-fixtures/mock-pages/*.html`) kullandığı sözleşme:
 *   - `.slot-item`       → her biri tek bir bookable randevu satırı.
 *   - `.no-slots-message` → randevu yokken gösterilen bilgi metni (yalnızca
 *     dokümantasyon amaçlı; ayrıştırma bu metne DAYANMAZ — kırılganlığı
 *     azaltmak için tek doğruluk kaynağı slot elemanlarının varlığı/yokluğudur).
 */
const SLOT_SELECTOR = '.slot-item';
const RESULTS_CONTAINER_SELECTOR = '.appointment-results';

/**
 * Ausländerbehörde randevu sayfası izleme — Playwright tabanlı PoC
 * (CLAUDE.md §5 Playwright, §6 Faz 3; tek kurum/şehir ile sınırlı).
 *
 * ETİK/HUKUKİ POLİTİKA (kasıtlı tasarım kararı):
 *   - Bu sınıf hangi URL'nin kontrol edileceğine KARAR VERMEZ; çağıran taraf
 *     (WatcherService, bir `AppointmentWatch` kaydı üzerinden) URL'yi verir.
 *     Otomatik keşif/tarama/crawling yoktur.
 *   - Varsayılan geliştirme ve TÜM testler yerel `file://` mock sayfaları
 *     üzerinde çalışır (bkz. test-fixtures/mock-pages/). Gerçek bir
 *     Ausländerbehörde sitesine yalnızca kullanıcı `.env`/DB üzerinden AÇIKÇA
 *     bir `targetUrl` verdiğinde istek atılır — kodda hard-coded gerçek URL
 *     YOKTUR.
 *   - Agresif polling (saniyeler/dakikalar mertebesinde) kurum sunucusuna
 *     orantısız yük bindirir ve etik değildir; bu yüzden WatcherService
 *     varsayılan olarak 30 dakikada bir kontrol eder (bkz. watcher.service.ts).
 */
@Injectable()
export class AppointmentChecker {
  private readonly logger = new Logger(AppointmentChecker.name);

  async check(url: string): Promise<AppointmentCheckResult> {
    const checkedAt = new Date();
    let browser: Browser | undefined;

    try {
      const { chromium } = await this.loadPlaywright();
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });

      // Sonuç konteynerini bekle; bulunamazsa yine de aşağıdaki slot
      // taraması denenir (sayfa yapısı beklenenden farklı olabilir).
      await page
        .waitForSelector(RESULTS_CONTAINER_SELECTOR, { timeout: 10_000 })
        .catch(() => undefined);

      const slotElements = await page.$$(SLOT_SELECTOR);
      const rawSlots = await Promise.all(
        slotElements.map(async (el) => ((await el.textContent()) ?? '').trim()),
      );
      const slots = rawSlots
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter((s) => s.length > 0);

      return { available: slots.length > 0, slots, checkedAt };
    } catch (error) {
      if (error instanceof PlaywrightNotAvailableError) throw error;
      if (this.isMissingBrowserError(error)) {
        throw new PlaywrightNotAvailableError(error);
      }
      throw error;
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  /**
   * `playwright` paketini çalışma anında (lazy) yükler.
   *
   * Statik `import` yerine dinamik `import()` kullanılır: paket kurulu
   * değilse (optionalDependency) bu, yalnızca `check()` çağrıldığında hata
   * verir — modülün geri kalanının (WatcherService, uygulama başlangıcı)
   * yüklenmesini ENGELLEMEZ.
   */
  private async loadPlaywright(): Promise<typeof import('playwright')> {
    try {
      return await import('playwright');
    } catch (error) {
      throw new PlaywrightNotAvailableError(error);
    }
  }

  private isMissingBrowserError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /executable doesn't exist|browserType\.launch/i.test(message);
  }
}

/**
 * `playwright` paketinin VE tarayıcı ikili dosyalarının (chromium) kurulu
 * olup olmadığını **senkron** ve **yan etkisiz** biçimde tespit eder
 * (tarayıcı başlatmadan — `executablePath()` yalnızca beklenen yolu döner).
 *
 * Testlerde `describe.skip`/`it.skip` kararını Jest'in koleksiyon (collection)
 * aşamasında, yani senkron biçimde vermek gerekir; bu yüzden burada gerçek
 * bir `launch()` DENENMEZ — yalnızca ikili dosyanın var olup olmadığına
 * bakılır. CI'da tarayıcı kurulu değilse bu `false` döner ve ilgili testler
 * FAIL DEĞİL, SKIP olur.
 */
export function isPlaywrightBrowserAvailable(): boolean {
  try {
    // Dinamik import yerine require: senkron sonuç gerekiyor (yukarıdaki not).
    const { chromium } = require('playwright') as typeof import('playwright');
    const execPath = chromium.executablePath();
    const fs = require('fs') as typeof import('fs');
    return fs.existsSync(execPath);
  } catch {
    return false;
  }
}

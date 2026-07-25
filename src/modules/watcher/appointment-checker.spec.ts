import * as path from 'path';
import { pathToFileURL } from 'url';
import {
  AppointmentChecker,
  isPlaywrightBrowserAvailable,
} from './appointment-checker';

/**
 * Bu testler GERÇEK bir Playwright tarayıcısı (chromium) gerektirir.
 *
 * CI/geliştirme ortamında `playwright install` çalıştırılmamış olabilir —
 * bu durumda testler FAIL değil, SKIP olmalı (görev tanımı, F3b). Karar,
 * Jest'in koleksiyon aşamasında senkron olarak `isPlaywrightBrowserAvailable()`
 * ile verilir (bkz. appointment-checker.ts).
 */
const maybeDescribe = isPlaywrightBrowserAvailable() ? describe : describe.skip;

function mockPageUrl(fileName: string): string {
  return pathToFileURL(
    path.join(__dirname, '..', '..', '..', 'test-fixtures', 'mock-pages', fileName),
  ).toString();
}

if (!isPlaywrightBrowserAvailable()) {
  // Jest ortamında en az bir `it` olmadan describe.skip sessizce geçer;
  // yine de neden atlandığını görünür kılmak için bilgilendirici bir not.
  console.warn(
    '[AppointmentChecker.spec] Playwright tarayıcısı kurulu değil — ' +
      'testler atlanıyor (bkz. MANUAL_ACTIONS_REQUIRED.md: `npx playwright install chromium`).',
  );
}

maybeDescribe('AppointmentChecker (Playwright gerekli)', () => {
  const checker = new AppointmentChecker();

  it(
    'randevu VAR mock sayfasında available:true ve dolu slot listesi döner',
    async () => {
      const result = await checker.check(mockPageUrl('termin-available.html'));

      expect(result.available).toBe(true);
      expect(result.slots.length).toBeGreaterThan(0);
      expect(result.slots[0]).toContain('2026');
      expect(result.checkedAt).toBeInstanceOf(Date);
    },
    30_000,
  );

  it(
    'randevu YOK mock sayfasında available:false ve boş slot listesi döner',
    async () => {
      const result = await checker.check(mockPageUrl('termin-none.html'));

      expect(result.available).toBe(false);
      expect(result.slots).toEqual([]);
    },
    30_000,
  );

  it(
    "var olmayan bir dosya URL'inde hata fırlatır (sessizce yutmaz)",
    async () => {
      await expect(
        checker.check(mockPageUrl('olmayan-sayfa.html')),
      ).rejects.toThrow();
    },
    30_000,
  );
});

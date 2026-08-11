import { AppConfigService } from '../../config/config.service';
import { RemindersService } from './reminders.service';
import { RetentionService } from './retention.service';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * `SCHEDULER_SKIP_STARTUP` regresyon testleri (D-047)
 *
 * Ayrı bir test bot token'ı Telegram KANALINI izole eder ama VERİTABANINI
 * etmez. `DB_DRIVER=supabase` ile yerelde uygulama açmak, üretim verisine
 * karşı **ikinci bir zamanlayıcı** çalıştırır:
 *   - `reminders-due` aynı hatırlatmayı ikinci kez gönderir ve/veya üretim
 *     göndermeden ÖNCE "sent" işaretler → kullanıcı hatırlatmasını hiç almaz,
 *   - `gdpr-purge` silme işlemiyle çakışır.
 * HANDOFF'ta `numReplicas: 1`'in gerekçesi budur; yerel `start:dev` fiilen
 * ikinci replikadır.
 *
 * ── Neden AppModule boot EDİLMİYOR (önemli) ─────────────────────────────────
 * `ConfigModule.forRoot()` doğrulamayı **import anında** çalıştırır. Spec
 * gövdesinde `process.env` değiştirmek bu yüzden ETKİSİZDİR — `AppModule`
 * dosyanın en üstünde import edildiği an env okunmuş olur. Ölçüldü:
 * `SCHEDULER_SKIP_STARTUP='true'` atandıktan sonra boot edilen uygulamada
 * `ConfigService.get(...)` hâlâ `false` dönüyor.
 *
 * Bu, D-043 testlerinin de bilinçli olarak servisi doğrudan (sahte config ile)
 * kurmasının sebebi. Aynı deseni izliyoruz: guard'ın kendisi burada, davranış
 * bütünlüğü ise `reminders.service.spec.ts`'te (varsayılan bayrakla) sınanır.
 * ════════════════════════════════════════════════════════════════════════════
 */

function makeConfig(skip: boolean): AppConfigService {
  return { schedulerSkipStartup: skip } as AppConfigService;
}

/** Erişilirse testi düşüren repo sahtesi — "hiç dokunulmadı" iddiasını kanıtlar. */
function forbiddenRepo(label: string): never {
  throw new Error(
    `İZOLASYON İHLALİ: guard açıkken ${label} çağrıldı — üretim verisine erişilirdi.`,
  );
}

describe('Zamanlayıcı izolasyonu — SCHEDULER_SKIP_STARTUP (D-047)', () => {
  describe('bayrak AÇIKKEN — veritabanına HİÇ dokunulmaz', () => {
    it('handleDueReminders: findDue() bile çağrılmaz', async () => {
      const reminders = {
        findDue: () => forbiddenRepo('ReminderRepository.findDue()'),
        markSent: () => forbiddenRepo('ReminderRepository.markSent()'),
      };
      const channel = { sendMessage: jest.fn() };

      const service = new RemindersService(
        reminders as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        channel as never,
        makeConfig(true),
      );

      // Guard EN BAŞTA olmalı. Sonra sınansaydı `findDue()` üretim
      // veritabanına çoktan gitmiş olurdu ve bu test patlardı.
      await expect(service.handleDueReminders()).resolves.toBeUndefined();
      expect(channel.sendMessage).not.toHaveBeenCalled();
    });

    it('handlePurgeCron: purgeNow() çağrılmaz (silme yapılmaz)', async () => {
      const service = new RetentionService(
        makeConfig(true),
        {} as never, {} as never, {} as never, {} as never,
        {} as never, {} as never, {} as never,
      );
      const purgeSpy = jest.spyOn(service, 'purgeNow');

      await expect(service.handlePurgeCron()).resolves.toBeUndefined();
      expect(purgeSpy).not.toHaveBeenCalled();
    });
  });

  describe('bayrak KAPALIYKEN — davranış birebir korunur', () => {
    it('handleDueReminders: findDue() çağrılır', async () => {
      const findDue = jest.fn().mockResolvedValue([]);
      const service = new RemindersService(
        { findDue } as never,
        {} as never, {} as never, {} as never, {} as never,
        {} as never, {} as never,
        makeConfig(false),
      );

      await service.handleDueReminders();
      expect(findDue).toHaveBeenCalledTimes(1);
    });

    it('handlePurgeCron: purgeNow() çağrılır', async () => {
      const service = new RetentionService(
        makeConfig(false),
        {} as never, {} as never, {} as never, {} as never,
        {} as never, {} as never, {} as never,
      );
      const purgeSpy = jest
        .spyOn(service, 'purgeNow')
        .mockResolvedValue({} as never);

      await service.handlePurgeCron();
      expect(purgeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('bayrak çözümlemesi (D-020 tuzağı)', () => {
    // `boolish` şeması: yalnızca 'true'/'1' açar; boş string varsayılana düşer.
    const { validateEnv } = require('../../config/env.schema');

    it.each([
      ['tanımsız', {}, false],
      ["boş string", { SCHEDULER_SKIP_STARTUP: '' }, false],
      ['false', { SCHEDULER_SKIP_STARTUP: 'false' }, false],
      ['true', { SCHEDULER_SKIP_STARTUP: 'true' }, true],
      ['1', { SCHEDULER_SKIP_STARTUP: '1' }, true],
    ])('%s → %s', (_label, env, expected) => {
      expect(validateEnv(env).SCHEDULER_SKIP_STARTUP).toBe(expected);
    });
  });
});

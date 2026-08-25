import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { AppConfigService } from '../../../config/config.service';
import { CryptoService } from '../../../common/crypto/crypto.service';

/**
 * Telegram webhook endpoint testleri (v1.1).
 *
 * En kritik iddia: **kimliği doğrulanmamış hiçbir update işlenmez.**
 * Webhook URL'i tahmin edilebilir olduğundan, gizli anahtar doğrulaması
 * sahte update enjeksiyonuna karşı tek savunmadır.
 */
describe('TelegramController — webhook', () => {
  const SECRET = 'super-secret-token';
  let app: INestApplication;
  let dispatch: jest.Mock;

  const build = async (secret?: string) => {
    dispatch = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [TelegramController],
      providers: [
        { provide: TelegramService, useValue: { dispatch } },
        {
          provide: AppConfigService,
          useValue: { telegramWebhookSecret: secret, isProduction: false },
        },
        {
          provide: CryptoService,
          useValue: {
            safeEqual: (a: string, b: string) => a === b,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    return app;
  };

  afterEach(async () => {
    await app?.close();
  });

  const update = {
    update_id: 1,
    message: {
      chat: { id: 42 },
      from: { id: 42, language_code: 'tr' },
      text: 'merhaba',
    },
  };

  // ── Kimlik doğrulama (KRİTİK) ─────────────────────────────────────────────
  describe('kimlik doğrulama', () => {
    it('doğru gizli anahtarla update işlenir', async () => {
      await build(SECRET);

      await request(app.getHttpServer())
        .post('/webhook/telegram')
        .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
        .send(update)
        .expect(200)
        .expect({ ok: true });

      expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('YANLIŞ anahtar → 401 ve update İŞLENMEZ', async () => {
      await build(SECRET);

      await request(app.getHttpServer())
        .post('/webhook/telegram')
        .set('X-Telegram-Bot-Api-Secret-Token', 'yanlis')
        .send(update)
        .expect(401);

      expect(dispatch).not.toHaveBeenCalled();
    });

    it('anahtar BAŞLIĞI YOK → 401 ve update İŞLENMEZ', async () => {
      await build(SECRET);

      await request(app.getHttpServer())
        .post('/webhook/telegram')
        .send(update)
        .expect(401);

      expect(dispatch).not.toHaveBeenCalled();
    });

    it('sunucuda sır TANIMSIZ ise fail-closed → 401 (herkese açık olmaz)', async () => {
      await build(undefined);

      await request(app.getHttpServer())
        .post('/webhook/telegram')
        .set('X-Telegram-Bot-Api-Secret-Token', 'herhangi')
        .send(update)
        .expect(401);

      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  // ── Update yönlendirme ────────────────────────────────────────────────────
  describe('update yönlendirme', () => {
    it('mesaj update\'i dispatch\'e iletilir', async () => {
      await build(SECRET);

      await request(app.getHttpServer())
        .post('/webhook/telegram')
        .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
        .send(update)
        .expect(200);

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ message: update.message }),
      );
    });

    it('düzenlenen mesaj (edited_message) da normal mesaj gibi işlenir', async () => {
      await build(SECRET);

      await request(app.getHttpServer())
        .post('/webhook/telegram')
        .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
        .send({ update_id: 2, edited_message: update.message })
        .expect(200);

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ message: update.message }),
      );
    });

    it('callback_query iletilir (onay butonları)', async () => {
      await build(SECRET);
      const cb = { id: 'x', data: 'approve:draft-1', from: { id: 42 } };

      await request(app.getHttpServer())
        .post('/webhook/telegram')
        .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
        .send({ update_id: 3, callback_query: cb })
        .expect(200);

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ callback_query: cb }),
      );
    });
  });

  // ── Dayanıklılık ──────────────────────────────────────────────────────────
  describe('dayanıklılık', () => {
    it('işleme hatasında bile 200 döner (Telegram sonsuz retry yapmasın)', async () => {
      await build(SECRET);
      dispatch.mockRejectedValue(new Error('işleme hatası'));

      await request(app.getHttpServer())
        .post('/webhook/telegram')
        .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
        .send(update)
        .expect(200)
        .expect({ ok: true });
    });

    it('boş/tanınmayan gövde çökertmez', async () => {
      await build(SECRET);

      await request(app.getHttpServer())
        .post('/webhook/telegram')
        .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
        .send({ update_id: 4 })
        .expect(200);
    });

    it('hata mesajı update İÇERİĞİNİ (olası PII) loglamaz', async () => {
      await build(SECRET);
      const logSpy = jest
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- `as never` köprüsü olmadan TS, private `logger`'a erişimi reddeder (TS2352); rule bunu yanlış pozitif olarak işaretliyor.
        .spyOn((app.get(TelegramController) as never as { logger: { error: () => void } }).logger, 'error')
        .mockImplementation(() => undefined);

      dispatch.mockRejectedValue(new Error('boom'));

      await request(app.getHttpServer())
        .post('/webhook/telegram')
        .set('X-Telegram-Bot-Api-Secret-Token', SECRET)
        .send({ update_id: 5, message: { ...update.message, text: 'Ahmet Yılmaz' } })
        .expect(200);

      const logged = logSpy.mock.calls.flat().join(' ');
      expect(logged).not.toContain('Ahmet Yılmaz');
      logSpy.mockRestore();
    });
  });
});

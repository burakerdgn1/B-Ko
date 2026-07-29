import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthController } from './health.controller';

/**
 * Liveness probe testleri.
 *
 * İki iddia korunuyor:
 *   1. `GET /health` her zaman 200 döner (Railway healthcheck yolu — 404 dönerse
 *      dağıtım "unhealthy" işaretlenip yeniden başlatma döngüsüne girer).
 *   2. Yanıt HİÇBİR yapılandırma/ortam bilgisi sızdırmaz. Endpoint herkese açık
 *      olduğu için bu bir güvenlik iddiasıdır, kozmetik bir tercih değil.
 */
describe('HealthController — liveness probe', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('200 ve status=ok döner', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('yalnızca status ve uptime döner — başka alan YOK', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    // Alan listesi bilinçli olarak TAM eşleşmeli: ileride biri "debug için"
    // ortam/sürüm/sürücü bilgisi eklerse bu test kırılır ve karar bilinçli
    // olarak yeniden verilir.
    expect(Object.keys(res.body).sort()).toEqual(['status', 'uptime']);
  });

  it('yanıt gövdesi hiçbir yapılandırma/sır değeri içermez', async () => {
    // Testin kendisi sır sızdırmasın diye gerçek `.env` değil, ortamda
    // bulunması muhtemel değişken ADLARI ve tipik önekler taranıyor.
    process.env.__HEALTH_PROBE_CANARY = 'canary-value-must-not-appear';

    const res = await request(app.getHttpServer()).get('/health').expect(200);
    const body = JSON.stringify(res.body);

    for (const forbidden of [
      'canary-value-must-not-appear',
      'sb_secret_',
      'sk-ant-',
      'SUPABASE',
      'ANTHROPIC',
      'TELEGRAM',
      'PII_MASTER_KEY',
      'production',
      'development',
    ]) {
      expect(body).not.toContain(forbidden);
    }

    delete process.env.__HEALTH_PROBE_CANARY;
  });

  it('kimlik doğrulaması istemez (platform probe anahtar taşımaz)', async () => {
    // Başlıksız istek de 200 olmalı — aksi hâlde healthcheck asla geçmez.
    await request(app.getHttpServer())
      .get('/health')
      .set('Authorization', '')
      .expect(200);
  });
});

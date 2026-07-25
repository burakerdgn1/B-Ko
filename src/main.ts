import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // NOT: Global `ValidationPipe` bilinçli olarak KURULMADI.
  //
  // Uygulamada şu an hiçbir HTTP controller'ı yok (giriş kanalı Telegram);
  // dolayısıyla doğrulanacak bir DTO da yok. `ValidationPipe`, `class-validator`
  // ve `class-transformer` paketlerini tembel olarak yüklemeye çalışıp her
  // açılışta "package is missing" uyarısı üretiyordu. Sıfır endpoint'e hizmet
  // etmek için iki çalışma-zamanı bağımlılığı eklemek doğru olmazdı.
  //
  // HTTP endpoint'i (ör. Telegram webhook) eklendiğinde:
  //   npm i class-validator class-transformer
  //   app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const config = app.get(AppConfigService);
  await app.listen(config.port);

  logger.log(`BüKo ${config.nodeEnv} modunda :${config.port} portunda çalışıyor`);
  logger.log(
    'Hatırlatma: BüKo hukuki tavsiye vermez — bilgilendirme/hazırlık asistanıdır.',
  );
}

void bootstrap();

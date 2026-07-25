import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.enableShutdownHooks();

  const config = app.get(AppConfigService);
  await app.listen(config.port);

  logger.log(`BüKo ${config.nodeEnv} modunda :${config.port} portunda çalışıyor`);
  logger.log(
    'Hatırlatma: BüKo hukuki tavsiye vermez — bilgilendirme/hazırlık asistanıdır.',
  );
}

void bootstrap();

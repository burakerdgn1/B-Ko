import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';
import { AppConfigService } from './config.service';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      /**
       * TESTLERDE `.env` OKUNMAZ (hermetik koşum).
       *
       * Neden: geliştiricinin yerel `.env`'i (ör. `LLM_MOCK=false` ve gerçek bir
       * API anahtarı) test davranışını sessizce değiştirir — testler GERÇEK
       * API'ye çıkmaya başlar, yavaşlar ve CI ile yerel sonuçlar ayrışır.
       * Bu gerçekten yaşandı: anahtar `.env`'e eklendiğinde 24 test kırıldı.
       * Testler yalnızca `process.env`'e (spec dosyalarının açıkça kurduğu
       * değerlere) dayanır.
       */
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      // Zod ile fail-fast doğrulama.
      validate: (raw) => validateEnv(raw),
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Bağımlılığı olmayan tek endpoint'lik modül (liveness probe).
 * Hiçbir servis enjekte etmez — bkz. `health.controller.ts` içindeki kapsam notu.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}

import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { LlmModule } from '../llm/llm.module';
import { DraftsService } from './drafts.service';

/**
 * Taslak üretimi + human-in-the-loop onay modülü (F3a).
 *
 * `PiiService`/`PiiVaultService` burada AYRICA import edilmiyor — `PiiModule`
 * kök `AppModule`'de `@Global()` olarak işaretli (bkz. common/pii/pii.module.ts),
 * bu yüzden `DraftsService`'in DI grafiğine otomatik enjekte edilir. Aynı desen
 * `AnalysisModule`'de de kullanılıyor.
 */
@Module({
  imports: [PersistenceModule, LlmModule],
  providers: [DraftsService],
  exports: [DraftsService],
})
export class DraftsModule {}

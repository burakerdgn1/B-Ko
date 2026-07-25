import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { LlmModule } from '../llm/llm.module';
import { AnalysisPipeline } from './analysis.pipeline';

@Module({
  imports: [PersistenceModule, LlmModule],
  providers: [AnalysisPipeline],
  exports: [AnalysisPipeline],
})
export class AnalysisModule {}

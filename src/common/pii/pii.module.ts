import { Global, Module } from '@nestjs/common';
import { PiiService } from './pii.service';
import { PiiVaultService } from './pii-vault.service';

@Global()
@Module({
  providers: [PiiService, PiiVaultService],
  exports: [PiiService, PiiVaultService],
})
export class PiiModule {}

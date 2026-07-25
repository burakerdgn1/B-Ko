import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { ProfileService } from './profile.service';

@Module({
  imports: [PersistenceModule],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}

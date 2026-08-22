import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { IdentityController } from './internal/identity.controller';
import { IdentityService } from './internal/identity.service';

@Module({
  imports: [DatabaseModule],
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}

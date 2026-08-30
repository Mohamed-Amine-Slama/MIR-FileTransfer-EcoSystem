import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { PlansController } from './internal/plans.controller';
import { PlansService } from './internal/plans.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}

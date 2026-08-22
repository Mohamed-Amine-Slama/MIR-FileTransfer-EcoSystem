import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { EventsModule } from '../../shared/events/events.module';
import { SchedulingController } from './internal/scheduling.controller';
import { SchedulingService } from './internal/scheduling.service';

@Module({
  imports: [DatabaseModule, EventsModule],
  controllers: [SchedulingController],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { EventsModule } from '../../shared/events/events.module';
import { SchedulingService } from './internal/scheduling.service';

@Module({
  imports: [DatabaseModule, EventsModule],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}

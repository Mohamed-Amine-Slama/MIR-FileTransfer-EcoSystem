import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { EventsModule } from '../../shared/events/events.module';
import { ConsentService } from './internal/consent.service';

@Module({
  imports: [DatabaseModule, EventsModule],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}

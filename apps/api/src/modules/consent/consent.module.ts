import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { EventsModule } from '../../shared/events/events.module';
import { ConsentController } from './internal/consent.controller';
import { ConsentService } from './internal/consent.service';

@Module({
  imports: [DatabaseModule, EventsModule],
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}

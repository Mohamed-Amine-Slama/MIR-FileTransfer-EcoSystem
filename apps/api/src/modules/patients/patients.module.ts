import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { EventsModule } from '../../shared/events/events.module';
import { PatientsController } from './internal/patients.controller';
import { PatientsService } from './internal/patients.service';

@Module({
  imports: [DatabaseModule, EventsModule],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/db/database.module';
import { EventsModule } from '../../shared/events/events.module';
import { AuditService } from './internal/audit.service';
import { AuditSubscriber } from './internal/audit.subscriber';

@Module({
  imports: [DatabaseModule, EventsModule],
  providers: [AuditService, AuditSubscriber],
  exports: [AuditService],
})
export class AuditModule {}

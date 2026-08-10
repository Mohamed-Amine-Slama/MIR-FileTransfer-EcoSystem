import { Module } from '@nestjs/common';
import { EventsModule } from '../../shared/events/events.module';
import { NotificationsSubscriber } from './internal/notifications.subscriber';

@Module({
  imports: [EventsModule],
  providers: [NotificationsSubscriber],
})
export class NotificationsModule {}

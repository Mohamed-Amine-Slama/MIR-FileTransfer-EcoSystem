import { Global, Module } from '@nestjs/common';
import { EventBus } from './event-bus';

/**
 * The in-process domain event bus (§5.2). Global so a new subscriber is one
 * class, not a wiring change in every module that emits.
 */
@Global()
@Module({
  providers: [EventBus],
  exports: [EventBus],
})
export class EventsModule {}

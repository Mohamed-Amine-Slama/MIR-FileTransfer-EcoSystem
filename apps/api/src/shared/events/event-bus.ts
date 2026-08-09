import { Injectable, Logger } from '@nestjs/common';
import type { DomainEvent, DomainEventType } from './domain-events';

type Handler<E extends DomainEvent = DomainEvent> = (event: E) => Promise<void> | void;

/**
 * In-process domain event bus — BUILD_SPEC §5.2.
 *
 * In-process because ADR-1 chose a modular monolith. A message broker here
 * would add a delivery-failure mode between two modules that are, physically,
 * the same process — a new way to lose the record that a scan was viewed,
 * bought at the price of infrastructure nobody needs yet.
 *
 * DELIVERY SEMANTICS, stated plainly because they matter for the audit trail:
 *
 *   * Handlers run after the emitting transaction has committed. Emitting
 *     inside the transaction would let a rollback erase the fact that
 *     something was attempted.
 *   * A failing subscriber does NOT fail the emitter. One broken notification
 *     template must not roll back a completed upload.
 *   * BUT audit is different: an unrecorded access is a compliance failure, so
 *     the audit subscriber writes synchronously and its failure IS surfaced.
 *     See AuditSubscriber.
 *
 * When a module is eventually extracted (ADR-1's exit path), this interface is
 * the seam a broker slots into.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly handlers = new Map<DomainEventType, Handler[]>();

  /** Subscribers that must not fail silently. */
  private readonly critical = new Set<Handler>();

  subscribe<T extends DomainEventType>(
    type: T,
    handler: Handler<Extract<DomainEvent, { type: T }>>,
    options: { critical?: boolean } = {},
  ): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as Handler);
    this.handlers.set(type, list);
    if (options.critical === true) this.critical.add(handler as Handler);
  }

  /**
   * Publish an event to all subscribers.
   *
   * Critical subscribers are awaited and their errors propagate. Non-critical
   * subscribers are awaited too — so ordering is deterministic in tests — but
   * their errors are logged and swallowed.
   */
  async publish(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? [];

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (err) {
        if (this.critical.has(handler)) {
          // An audit write that fails must not be swallowed. Losing the record
          // of who opened a patient's scan is the failure the audit log exists
          // to prevent.
          throw err;
        }
        this.logger.error(
          `subscriber failed for ${event.type} (requestId=${event.requestId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /** Test helper: how many subscribers are registered for a type. */
  subscriberCount(type: DomainEventType): number {
    return (this.handlers.get(type) ?? []).length;
  }
}

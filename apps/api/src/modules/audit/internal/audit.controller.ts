import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { AuditService } from './audit.service';

/**
 * Audit review — BUILD_SPEC P6.
 *
 * Admin only, and READ ONLY. There is no route here that writes, updates or
 * deletes an audit row, and adding one would not work: the application role
 * has no UPDATE or DELETE grant on the table.
 *
 * Reading the audit log is itself a sensitive action — it reveals which
 * patients exist and who has been looking at them — which is why it is
 * restricted to `admin` and not extended to clinicians for "their own" rows.
 */

const querySchema = z.object({
  // Bounded. An unbounded limit on a table that grows forever is a way to take
  // the API down with one request.
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @RequiresRole('admin')
  @Get()
  async recent(@Query() query: unknown): Promise<{
    events: {
      id: string;
      occurredAt: string;
      actorUserId: string | null;
      action: string;
      outcome: 'allowed' | 'denied';
      resourceType: string;
    }[];
  }> {
    const { limit } = querySchema.parse(query);
    const events = await this.audit.recent(limit);
    return {
      events: events.map((e) => ({
        id: e.id,
        occurredAt: e.occurredAt.toISOString(),
        actorUserId: e.actorUserId,
        action: e.action,
        outcome: e.outcome,
        resourceType: e.resourceType,
      })),
    };
  }
}

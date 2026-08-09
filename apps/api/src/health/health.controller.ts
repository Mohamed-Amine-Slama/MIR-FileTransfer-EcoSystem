import { Controller, Get } from '@nestjs/common';
import { PublicEndpoint } from '../shared/authz/access-metadata';

/**
 * Liveness endpoint (BUILD_SPEC P1.1).
 *
 * Deliberately returns nothing but a literal status. A health endpoint that
 * reports version numbers, hostnames, or dependency detail is a free
 * reconnaissance surface on an unauthenticated route, and BUILD_SPEC §6
 * forbids leaking internal identifiers to clients.
 *
 * Readiness (can we reach Postgres / Orthanc / S3?) is a separate concern and
 * belongs on an internal-only route, not here.
 */
@Controller()
export class HealthController {
  // Deliberately public: the load balancer must be able to probe it without
  // credentials. This is why it returns nothing but a literal status.
  @PublicEndpoint()
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

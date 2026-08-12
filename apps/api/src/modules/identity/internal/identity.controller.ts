import { Controller, Get } from '@nestjs/common';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { IdentityService, type CurrentUser } from './identity.service';

/**
 * Session introspection — the endpoint every screen calls on load.
 *
 * ALL FOUR ROLES, and no @PublicEndpoint. An anonymous caller gets 401 from
 * the guard, which is exactly what the web client uses to decide it is
 * anonymous. Making this public so it could answer "nobody" would mean an
 * unauthenticated request reaching application code, for no gain.
 */
@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @RequiresRole('patient', 'libya_doctor', 'tunisia_doctor', 'admin')
  @Get('me')
  async me(): Promise<CurrentUser> {
    return this.identity.currentUser();
  }
}

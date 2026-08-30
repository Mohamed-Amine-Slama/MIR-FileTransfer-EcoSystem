import { Module } from '@nestjs/common';
import { ConfigModule } from '../../shared/config/config.module';
import { DatabaseModule } from '../../shared/db/database.module';
import { MailModule } from '../../shared/mail';
import { IdentityController } from './internal/identity.controller';
import { IdentityService } from './internal/identity.service';
import { KeycloakAdminClient } from './internal/keycloak-admin.client';
import { ProfileController } from './internal/profile.controller';
import { ProfileService } from './internal/profile.service';
import { RegistrationController } from './internal/registration.controller';
import { RegistrationService } from './internal/registration.service';

@Module({
  imports: [ConfigModule, DatabaseModule, MailModule],
  controllers: [IdentityController, ProfileController, RegistrationController],
  providers: [IdentityService, ProfileService, RegistrationService, KeycloakAdminClient],
  // KeycloakAdminClient is exported because the verification decision
  // (organisations module) must assign the realm role that the granted
  // application role mirrors — the two halves of becoming a clinician.
  exports: [IdentityService, KeycloakAdminClient],
})
export class IdentityModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '../../shared/config/config.module';
import { DatabaseModule } from '../../shared/db/database.module';
import { MailModule } from '../../shared/mail';
import { IdentityModule } from '../identity';
import { OrganisationsController } from './internal/organisations.controller';
import { OrganisationsService } from './internal/organisations.service';

/**
 * Depends on `identity` through its public index only (P1.4), for the one thing
 * it genuinely needs: attaching the realm role that an approval grants. The two
 * halves of becoming a clinician — the application row and the token claim —
 * have to happen together, and only identity owns the second.
 */
@Module({
  imports: [ConfigModule, DatabaseModule, MailModule, IdentityModule],
  controllers: [OrganisationsController],
  providers: [OrganisationsService],
  exports: [OrganisationsService],
})
export class OrganisationsModule {}

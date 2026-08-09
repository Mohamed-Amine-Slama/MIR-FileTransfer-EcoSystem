import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { HealthModule } from './health/health.module';
import { AuthGuard } from './shared/auth/auth.guard';
import { TokenVerifier } from './shared/auth/token-verifier';
import { ConfigModule } from './shared/config/config.module';
import { RequestContextMiddleware } from './shared/context/request-context.middleware';
import { DatabaseModule } from './shared/db/database.module';
import { GlobalExceptionFilter } from './shared/errors/global-exception.filter';
import { EventsModule } from './shared/events/events.module';
import { AuditModule } from './modules/audit';
import { ConsentModule } from './modules/consent';
import { ImagingModule } from './modules/imaging';
import { PatientsModule } from './modules/patients';

/**
 * Application root.
 *
 * Module boundaries are enforced structurally by dependency-cruiser (P1.4),
 * not by convention. Note that domain modules are imported through their
 * public `index.ts` only — reaching into `modules/x/internal/...` from here
 * would fail the build.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    EventsModule,
    // Needed by the P1.5 bootstrap audit to enumerate every registered route.
    DiscoveryModule,
    HealthModule,
    AuditModule,
    PatientsModule,
    ConsentModule,
    ImagingModule,
  ],
  providers: [
    TokenVerifier,
    // Global by default: an undeclared route is unreachable, and P1.5 refuses
    // to boot if one exists at all.
    { provide: APP_GUARD, useClass: AuthGuard },
    // §6: no stack traces, no SQL, no internal identifiers in any response.
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Must cover every route: this opens the AsyncLocalStorage scope that the
    // auth guard fills in and that DatabaseService reads to set the RLS
    // session context. A route without it fails at request time, not at boot.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

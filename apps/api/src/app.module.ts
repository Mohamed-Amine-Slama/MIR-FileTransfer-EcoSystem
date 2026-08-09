import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { HealthModule } from './health/health.module';

/**
 * Application root.
 *
 * Domain modules from BUILD_SPEC §5 are registered here as they are built.
 * Module boundaries are enforced structurally by dependency-cruiser (P1.4),
 * not by convention — see .dependency-cruiser.cjs.
 */
@Module({
  imports: [
    // Needed by the P1.5 bootstrap audit to enumerate every registered route.
    DiscoveryModule,
    HealthModule,
  ],
})
export class AppModule {}

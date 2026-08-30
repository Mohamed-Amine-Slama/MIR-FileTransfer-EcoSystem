import { Global, Module } from '@nestjs/common';
import { MemoryRateLimitStore, RateLimiter } from './rate-limiter';

/**
 * P4.5 wiring.
 *
 * `RateLimiter`'s constructor takes a `RateLimitStore` INTERFACE, which erases
 * to `Object` at runtime and cannot be resolved by Nest's DI. A factory keeps
 * the store choice explicit rather than relying on a default parameter that
 * the container would try, and fail, to fill.
 *
 * THE STORE IS IN MEMORY, AND THAT IS A REAL LIMITATION. Buckets live in the
 * process, so N application instances behind a load balancer permit N times
 * the intended rate, and a deploy resets every lockout. `REDIS_URL` is already
 * a required config key and `redis` is already in the compose file — but no
 * Redis client is installed and nothing reads that key, so a distributed store
 * would be new dependencies and a new failure mode added for a deployment that
 * does not yet exist. Correct for the single local instance that does exist;
 * MUST be swapped for a Redis-backed store before the API runs more than one
 * replica. Recorded in the checklist as a pre-deploy task rather than fixed
 * speculatively here.
 */
@Global()
@Module({
  providers: [{ provide: RateLimiter, useFactory: () => new RateLimiter(new MemoryRateLimitStore()) }],
  exports: [RateLimiter],
})
export class RateLimitModule {}

import { Global, Module } from '@nestjs/common';
import { loadConfig, type AppConfig } from './config.schema';

export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Global config provider. Validated once at boot (P1.6); every consumer
 * receives the same frozen object.
 *
 * Global because configuration is genuinely cross-cutting — the alternative is
 * importing ConfigModule into all eight domain modules, which adds noise
 * without adding isolation.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => Object.freeze(loadConfig()),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}

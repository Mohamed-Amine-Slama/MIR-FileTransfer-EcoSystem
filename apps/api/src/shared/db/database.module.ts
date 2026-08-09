import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { DatabaseService } from './database.service';

/**
 * Single database access point. Global because every module needs it and
 * there is exactly one — no second, privileged pool exists (ADR-6, §17).
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}

import { Global, Module } from '@nestjs/common';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { APP_CONFIG, ConfigModule } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import type { BlobStore } from './blob-store';
import { LocalBlobStore } from './local-blob-store';

export const BLOB_STORE = Symbol('BLOB_STORE');

/**
 * Object storage provider.
 *
 * Production uses S3 with the guarantees P2.4 requires (Object Lock,
 * versioning, SSE-KMS, cross-region replication). Development and CI use the
 * local filesystem, so the ingestion pipeline can be exercised with real bytes
 * and real checksums without an AWS account.
 *
 * The S3 implementation is NOT yet written — there is no AWS account attached
 * to this work, and an untested storage backend for the source of record is
 * worse than an obviously absent one. Selecting it in a non-development
 * environment therefore fails loudly at boot rather than silently falling back
 * to local disk, which would put the only copy of a patient's scan on an
 * ephemeral container filesystem.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: BLOB_STORE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): BlobStore => {
        if (config.NODE_ENV === 'production' || config.NODE_ENV === 'staging') {
          throw new Error(
            'No production-grade BlobStore is configured. S3BlobStore is not ' +
              'implemented yet (BUILD_SPEC P2.4 is unresolved: no AWS account). ' +
              'Refusing to start rather than writing originals to local disk.',
          );
        }
        return new LocalBlobStore(config.LOCAL_STORAGE_ROOT ?? join(tmpdir(), 'mir-storage'));
      },
    },
  ],
  exports: [BLOB_STORE],
})
export class StorageModule {}

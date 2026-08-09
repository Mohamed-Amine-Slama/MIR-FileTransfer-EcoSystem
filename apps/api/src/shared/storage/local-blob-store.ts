import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  ObjectAlreadyExistsError,
  ObjectNotFoundError,
  type BlobStore,
} from './blob-store';

/**
 * Filesystem-backed BlobStore for local development and CI.
 *
 * NOT for production — it provides none of what P2.4 requires: no Object Lock,
 * no versioning, no cross-region replication, no SSE-KMS. It exists so the
 * ingestion pipeline (P7.4) can be exercised end-to-end with real bytes and
 * real checksums without an AWS account, which is the difference between
 * testing the pipeline and testing a mock of it.
 *
 * It does enforce the one behavioural guarantee the code depends on:
 * originals are write-once.
 */
export class LocalBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  // --- path safety ---------------------------------------------------------

  /**
   * Resolve a key inside its bucket directory, refusing anything that escapes.
   *
   * Keys are built from DICOM UIDs, which come from uploaded files. `sanitiseUid`
   * is the first line of defence; this is the second, because a single missed
   * call site would otherwise turn a malformed UID into an arbitrary file write.
   */
  private path(bucket: string, key: string): string {
    const base = resolve(this.root, bucket);
    const full = resolve(base, key);
    if (full !== base && !full.startsWith(base + sep)) {
      throw new Error(`Refusing to resolve key outside its bucket: ${JSON.stringify(key)}`);
    }
    return full;
  }

  private async ensureDir(file: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
  }

  // --- staging -------------------------------------------------------------

  async appendChunk(stagingKey: string, _chunkIndex: number, data: Uint8Array): Promise<void> {
    const file = this.path('staging', stagingKey);
    await this.ensureDir(file);
    // Append rather than write-at-offset: chunks arrive strictly in order, and
    // the resume point is derived from the file size, so the two can never
    // disagree about how much has been received.
    await appendFile(file, data);
  }

  async stagedSize(stagingKey: string): Promise<number> {
    try {
      const s = await stat(this.path('staging', stagingKey));
      return s.size;
    } catch {
      return 0;
    }
  }

  async readStaged(stagingKey: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.path('staging', stagingKey)));
    } catch {
      throw new ObjectNotFoundError(stagingKey);
    }
  }

  async discardStaged(stagingKey: string): Promise<void> {
    await rm(this.path('staging', stagingKey), { force: true });
  }

  // --- originals: write once -----------------------------------------------

  async putOriginal(key: string, data: Uint8Array): Promise<void> {
    const file = this.path('originals', key);
    await this.ensureDir(file);
    try {
      // 'wx' fails if the file exists. This mirrors Object Lock: an original
      // is never replaced, and an attempt to do so is an error the caller must
      // handle (as idempotent re-upload) rather than silently overwrite.
      await writeFile(file, data, { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ObjectAlreadyExistsError(key);
      }
      throw err;
    }
  }

  async getOriginal(key: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.path('originals', key)));
    } catch {
      throw new ObjectNotFoundError(key);
    }
  }

  async originalExists(key: string): Promise<boolean> {
    try {
      await stat(this.path('originals', key));
      return true;
    } catch {
      return false;
    }
  }

  // --- derived -------------------------------------------------------------

  async putDerived(key: string, data: Uint8Array): Promise<void> {
    const file = this.path('derived', key);
    await this.ensureDir(file);
    await writeFile(file, data);
  }

  async derivedExists(key: string): Promise<boolean> {
    try {
      await stat(this.path('derived', key));
      return true;
    } catch {
      return false;
    }
  }

  /** Test helper: absolute path for assertions. */
  originalPath(key: string): string {
    return join(this.root, 'originals', key);
  }
}

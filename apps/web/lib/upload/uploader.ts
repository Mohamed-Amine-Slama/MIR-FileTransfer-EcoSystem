import { queueDb, reconcileAfterRestart, type QueuedFile } from './queue-db';

/**
 * Upload orchestrator — BUILD_SPEC P7.3.
 *
 * Drives the persistent queue: hashes, compresses, sends chunks, and resumes
 * from wherever the server says it left off.
 *
 * DESIGN POINT — THE SERVER OWNS THE RESUME POINT.
 * The client's own `nextChunkIndex` is a cache, not the truth. On every start
 * it re-registers each file and takes the offset the server returns. A client
 * that trusted its local counter after a crash could skip a chunk that never
 * actually landed, producing a file that fails checksum only after the whole
 * transfer completed — over a link that charges by the megabyte.
 */

export interface UploaderApi {
  createSession(patientId: string, expectedFileCount: number): Promise<{ sessionId: string }>;
  registerFile(input: {
    sessionId: string;
    clientFileId: string;
    fileName: string;
    sizeBytes: number;
    sha256: string;
    contentEncoding: 'gzip' | 'identity';
  }): Promise<{ fileId: string; nextChunkIndex: number; receivedBytes: number; chunkSizeBytes: number }>;
  sendChunk(fileId: string, chunkIndex: number, data: Uint8Array): Promise<void>;
  completeFile(fileId: string): Promise<void>;
}

export interface UploaderEvents {
  onProgress?: (files: QueuedFile[]) => void;
}

/** Container-level gzip (P7.3 step 4). Never touches pixel data (ADR-5). */
async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class Uploader {
  private running = false;
  private stopRequested = false;

  constructor(
    private readonly api: UploaderApi,
    private readonly events: UploaderEvents = {},
  ) {}

  /**
   * Add a folder selection to the queue.
   *
   * Files are NOT filtered by extension. A study on a clinic CD is routinely
   * extensionless (`IM000001`) and nested under `DICOM/` or `IMAGES/`; a
   * `.dcm` filter would silently skip the entire study. Whether each file is
   * really DICOM is decided server-side (P7.4) — the client never gets a vote
   * on that.
   */
  async enqueueFiles(sessionId: string, patientId: string, files: File[]): Promise<number> {
    let added = 0;
    for (const file of files) {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      const path = relativePath !== undefined && relativePath !== '' ? relativePath : file.name;

      // Skip the junk that macOS and Windows scatter across removable media.
      // These are never DICOM and would each cost a round trip to be rejected.
      const base = path.split('/').pop() ?? path;
      if (base.startsWith('._') || base === '.DS_Store' || base === 'Thumbs.db') continue;
      if (file.size === 0) continue;

      const id = `${sessionId}:${path}`;
      if ((await queueDb.get(id)) !== undefined) continue;

      await queueDb.put({
        id,
        sessionId,
        patientId,
        relativePath: path,
        fileName: base,
        sizeBytes: file.size,
        sha256: null,
        serverFileId: null,
        nextChunkIndex: 0,
        uploadedBytes: 0,
        status: 'pending',
        attempts: 0,
        lastError: null,
        file,
        queuedAt: Date.now(),
        updatedAt: Date.now(),
      });
      added++;
    }
    await this.emit();
    return added;
  }

  /**
   * Resume everything outstanding. Safe to call on every page load — that is
   * how the queue survives a reload or a crash without user action.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;

    try {
      await reconcileAfterRestart();

      for (;;) {
        if (this.stopRequested) break;
        const outstanding = await queueDb.outstanding();
        if (outstanding.length === 0) break;

        const next = outstanding[0];
        if (next === undefined) break;

        try {
          await this.uploadOne(next);
        } catch (err) {
          // One bad file must not stall the queue behind it. Mark it for retry
          // and move on; a doctor with 119 good slices and one unreadable file
          // should still get the 119 across.
          await queueDb.update(next.id, {
            status: next.attempts >= 4 ? 'failed' : 'retrying',
            attempts: next.attempts + 1,
            lastError: err instanceof Error ? err.message : String(err),
          });
          await this.emit();
          if (next.attempts >= 4) continue;
          await delay(backoffMs(next.attempts));
        }
      }
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    this.stopRequested = true;
  }

  private async uploadOne(entry: QueuedFile): Promise<void> {
    await queueDb.update(entry.id, { status: 'uploading' });
    await this.emit();

    // The File handle may have gone stale — CD ejected, file moved. Say so
    // rather than failing with an opaque read error.
    let buffer: ArrayBuffer;
    try {
      buffer = await entry.file.arrayBuffer();
    } catch {
      await queueDb.update(entry.id, {
        status: 'needs_reselect',
        lastError: 'File is no longer readable. Re-select the folder to continue.',
      });
      await this.emit();
      return;
    }

    const original = new Uint8Array(buffer);
    const digest = entry.sha256 ?? (await sha256Hex(buffer));
    if (entry.sha256 === null) await queueDb.update(entry.id, { sha256: digest });

    const payload = await gzip(original);

    // Re-register every time: the SERVER's offset is authoritative (see the
    // class comment). This is also what makes a machine restart resumable —
    // the client asks rather than assumes.
    const registered = await this.api.registerFile({
      sessionId: entry.sessionId,
      clientFileId: entry.relativePath,
      fileName: entry.fileName,
      sizeBytes: original.byteLength,
      sha256: digest,
      contentEncoding: 'gzip',
    });

    const chunkSize = registered.chunkSizeBytes;
    const totalChunks = Math.max(1, Math.ceil(payload.byteLength / chunkSize));

    for (let i = registered.nextChunkIndex; i < totalChunks; i++) {
      if (this.stopRequested) {
        await queueDb.update(entry.id, { status: 'pending' });
        return;
      }
      const slice = payload.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, payload.byteLength));
      await this.api.sendChunk(registered.fileId, i, slice);

      await queueDb.update(entry.id, {
        serverFileId: registered.fileId,
        nextChunkIndex: i + 1,
        // Progress is reported against the ORIGINAL size, which is what the
        // doctor recognises. Compressed byte counts would show a bar that
        // reaches 100% having transferred a third of the file.
        uploadedBytes: Math.min(original.byteLength, Math.round(((i + 1) / totalChunks) * original.byteLength)),
      });
      await this.emit();
    }

    await queueDb.update(entry.id, { status: 'verifying' });
    await this.emit();

    await this.api.completeFile(registered.fileId);

    await queueDb.update(entry.id, {
      status: 'done',
      uploadedBytes: original.byteLength,
      lastError: null,
    });
    await this.emit();
  }

  private async emit(): Promise<void> {
    if (this.events.onProgress === undefined) return;
    this.events.onProgress(await queueDb.all());
  }
}

/** Exponential backoff, so a flapping link is not hammered. */
function backoffMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** attempt);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * IndexedDB-backed upload queue — BUILD_SPEC P7.3.
 *
 * "Queue survives page reload, browser crash, and machine restart; resumes
 * automatically on next open."
 *
 * WHY INDEXEDDB AND NOT localStorage:
 * localStorage is synchronous (it blocks the main thread), capped around 5 MB,
 * and stores strings only. A study is hundreds of files totalling up to a
 * gigabyte; the File handles and per-chunk progress for that do not fit, and
 * serialising them through JSON on every chunk would stall the UI on the one
 * machine least able to afford it — a clinic PC on a slow link.
 *
 * WHAT IS AND IS NOT STORED:
 * file CONTENT is not copied into IndexedDB. Browsers keep a `File` handle
 * valid across reloads as long as the underlying file is untouched, and
 * duplicating a gigabyte of DICOM into the database would double disk use for
 * no benefit. If a handle does go stale — the CD was ejected, the file moved —
 * the entry is marked `needs_reselect` rather than silently dropped, because a
 * study that quietly stops uploading is worse than one that says why.
 *
 * Written without a wrapper library on purpose: this is the component that
 * decides whether a doctor's work survives a crash, and its failure modes
 * should be readable in one file.
 */

const DB_NAME = 'mir-uploads';
const DB_VERSION = 1;
const STORE = 'queued_files';

export type QueuedFileStatus =
  | 'pending'
  | 'uploading'
  | 'verifying'
  | 'done'
  | 'retrying'
  | 'needs_reselect'
  | 'failed';

export interface QueuedFile {
  /** Stable id: session + relative path. Survives restarts. */
  id: string;
  sessionId: string;
  patientId: string;
  /** Path within the selected folder, e.g. "DICOM/IM000001". */
  relativePath: string;
  fileName: string;
  sizeBytes: number;
  /** SHA-256 of the ORIGINAL file. Computed once, reused across restarts. */
  sha256: string | null;
  /** Server-side file id, once registered. */
  serverFileId: string | null;
  nextChunkIndex: number;
  uploadedBytes: number;
  status: QueuedFileStatus;
  attempts: number;
  lastError: string | null;
  /** The browser's handle to the file on disk. Not the content. */
  file: File;
  queuedAt: number;
  updatedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('by_session', 'sessionId', { unique: false });
        store.createIndex('by_status', 'status', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = fn(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
        transaction.oncomplete = () => db.close();
      }),
  );
}

export const queueDb = {
  async put(entry: QueuedFile): Promise<void> {
    await tx('readwrite', (store) => store.put({ ...entry, updatedAt: Date.now() }));
  },

  async get(id: string): Promise<QueuedFile | undefined> {
    return tx<QueuedFile | undefined>('readonly', (store) => store.get(id));
  },

  async all(): Promise<QueuedFile[]> {
    const rows = await tx<QueuedFile[]>('readonly', (store) => store.getAll());
    return rows.sort((a, b) => a.queuedAt - b.queuedAt);
  },

  /**
   * Everything still owed to the server, oldest first.
   *
   * `uploading` counts as outstanding: a file in that state when the app
   * starts was interrupted mid-transfer, which is precisely the case that must
   * resume rather than be treated as in-flight by a process that no longer
   * exists.
   */
  async outstanding(): Promise<QueuedFile[]> {
    const rows = await this.all();
    return rows.filter(
      (r) => r.status === 'pending' || r.status === 'uploading' || r.status === 'retrying',
    );
  },

  async update(id: string, patch: Partial<QueuedFile>): Promise<void> {
    const existing = await this.get(id);
    if (existing === undefined) return;
    await this.put({ ...existing, ...patch });
  },

  async remove(id: string): Promise<void> {
    await tx('readwrite', (store) => store.delete(id));
  },

  async clear(): Promise<void> {
    await tx('readwrite', (store) => store.clear());
  },
};

/**
 * Recover from an unclean shutdown.
 *
 * Anything left `uploading` belongs to a process that is gone. It is moved to
 * `pending` so the resume loop picks it up; the byte offset is NOT reset,
 * because the server holds the authoritative resume point and re-sending from
 * zero is exactly the cost P7 exists to avoid.
 */
export async function reconcileAfterRestart(): Promise<number> {
  const rows = await queueDb.all();
  let recovered = 0;
  for (const row of rows) {
    if (row.status === 'uploading' || row.status === 'verifying') {
      await queueDb.update(row.id, { status: 'pending' });
      recovered++;
    }
  }
  return recovered;
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createUploadApi } from '../../lib/upload/api-client';
import { queueDb, type QueuedFile } from '../../lib/upload/queue-db';
import { Uploader } from '../../lib/upload/uploader';

/**
 * Upload screen — BUILD_SPEC P7.3.
 *
 * Two behaviours matter more than anything visual here:
 *
 * 1. It resumes on mount, with no user action. A doctor whose browser crashed
 *    mid-study reopens the tab and the transfer continues. Requiring them to
 *    click "resume" would mean uploads silently stall whenever nobody notices.
 *
 * 2. Progress and retry state are per file and visible. On a link that drops
 *    every few minutes, "it's working" is not enough information — the doctor
 *    needs to see which files are still owed before they leave the clinic.
 */
export default function UploadPage() {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const uploaderRef = useRef<Uploader | null>(null);

  const getUploader = useCallback((): Uploader => {
    uploaderRef.current ??= new Uploader(createUploadApi(), {
      onProgress: (next) => setFiles([...next]),
    });
    return uploaderRef.current;
  }, []);

  // Resume on mount. This is the P7.3 gate: survives reload, crash, restart.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const outstanding = await queueDb.outstanding();
      if (cancelled) return;
      setFiles(await queueDb.all());
      if (outstanding.length > 0) {
        setResumeNotice(`Resuming ${outstanding.length} file(s) from the previous session`);
        void getUploader().start();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getUploader]);

  const onFolderSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(event.target.files ?? []);
      if (selected.length === 0) return;

      const api = createUploadApi();
      // In the real flow the patient is chosen on the previous screen; the
      // element below carries it so this page stays independent of routing.
      const patientId =
        document.querySelector<HTMLInputElement>('#patient-id')?.value ?? 'unknown';

      const { sessionId } = await api.createSession(patientId, selected.length);
      const uploader = getUploader();
      await uploader.enqueueFiles(sessionId, patientId, selected);
      void uploader.start();
    },
    [getUploader],
  );

  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
  const doneBytes = files.reduce((sum, f) => sum + f.uploadedBytes, 0);
  const pct = totalBytes === 0 ? 0 : Math.round((doneBytes / totalBytes) * 100);

  return (
    <main>
      <h1>رفع الصور الطبية</h1>
      <p style={{ color: 'var(--color-muted)' }}>
        اختر مجلد الدراسة من القرص. يمكن إغلاق المتصفح — سيستأنف الرفع تلقائيًا.
      </p>

      {resumeNotice !== null && (
        <p data-testid="resume-notice" style={banner}>
          {resumeNotice}
        </p>
      )}

      <input type="hidden" id="patient-id" defaultValue="" />

      <label style={{ display: 'block', marginBlock: '1rem' }}>
        {/* webkitdirectory: a study is a FOLDER of many files, often
            extensionless, often under DICOM/ or IMAGES/ on a clinic CD. */}
        <input
          data-testid="folder-input"
          type="file"
          multiple
          // @ts-expect-error — non-standard but universally supported attribute
          webkitdirectory=""
          directory=""
          onChange={(e) => void onFolderSelected(e)}
        />
      </label>

      <div data-testid="overall-progress" data-percent={pct} style={{ marginBlock: '1rem' }}>
        <strong>{pct}%</strong> — {files.filter((f) => f.status === 'done').length} /{' '}
        {files.length} ملف
      </div>

      <ul data-testid="file-list" style={{ listStyle: 'none', padding: 0 }}>
        {files.map((f) => (
          <li
            key={f.id}
            data-testid="file-row"
            data-status={f.status}
            data-name={f.relativePath}
            style={row}
          >
            <span style={{ flex: 1, wordBreak: 'break-all' }}>{f.relativePath}</span>
            <span style={{ color: 'var(--color-muted)' }}>{statusLabel(f)}</span>
            {f.lastError !== null && (
              <span data-testid="file-error" style={{ color: 'var(--color-warning-fg)' }}>
                {f.lastError}
              </span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

function statusLabel(f: QueuedFile): string {
  switch (f.status) {
    case 'done':
      return 'تم';
    case 'uploading':
      return `${Math.round((f.uploadedBytes / Math.max(1, f.sizeBytes)) * 100)}%`;
    case 'verifying':
      return 'جارٍ التحقق';
    case 'retrying':
      return `إعادة المحاولة (${f.attempts})`;
    case 'needs_reselect':
      return 'أعد اختيار المجلد';
    case 'failed':
      return 'فشل';
    default:
      return 'في الانتظار';
  }
}

const banner: React.CSSProperties = {
  background: 'var(--color-warning-bg)',
  color: 'var(--color-warning-fg)',
  padding: '0.75rem 1rem',
  borderRadius: '0.5rem',
};

const row: React.CSSProperties = {
  display: 'flex',
  gap: '1rem',
  alignItems: 'center',
  paddingBlock: '0.4rem',
  borderBottom: '1px solid var(--color-border)',
};

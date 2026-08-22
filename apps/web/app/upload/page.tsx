'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Patient } from '../../lib/api/endpoints';
import { createUploadApi } from '../../lib/upload/api-client';
import { queueDb, type QueuedFile } from '../../lib/upload/queue-db';
import { Uploader } from '../../lib/upload/uploader';
import { useT } from '../../lib/i18n/provider';
import { RoleGate } from '../../components/RoleGate';
import { Field, Select } from '../../components/ui';

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
  return (
    <RoleGate allow={['libya_doctor']}>
      <UploadScreen />
    </RoleGate>
  );
}

function UploadScreen() {
  const t = useT();
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState('');
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

  // The doctor's own patients, for attaching the study to a record. RLS
  // decides which rows come back; this list is never filtered client-side.
  useEffect(() => {
    void (async () => {
      try {
        const { patients: rows } = await api.patients.list();
        setPatients(rows);
      } catch {
        // Upload is still usable if this fails — the selector simply stays
        // empty and the doctor is blocked from starting, which is better than
        // uploading a study against a guessed patient id.
        setPatients([]);
      }
    })();
  }, []);

  const onFolderSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(event.target.files ?? []);
      if (selected.length === 0 || patientId === '') return;

      const uploadApi = createUploadApi();
      const { sessionId } = await uploadApi.createSession(patientId, selected.length);
      const uploader = getUploader();
      await uploader.enqueueFiles(sessionId, patientId, selected);
      void uploader.start();
    },
    [getUploader, patientId],
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

      {/* The study is attached to a patient record at the moment the session
          is created, not afterwards. An upload with no owner would be imaging
          that RLS cannot scope to anyone — unreachable, and undeletable by the
          application role. */}
      <div style={{ marginBlock: '1rem' }}>
        <Field label={t.patientsTitle}>
          <Select
            data-testid="patient-select"
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
          >
            <option value="">—</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} · {p.phoneE164}
              </option>
            ))}
          </Select>
        </Field>
      </div>

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

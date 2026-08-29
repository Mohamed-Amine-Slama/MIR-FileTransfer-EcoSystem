import { describe, expect, it } from 'vitest';
import {
  FILE_ACCESS_ACTIONS,
  MAX_MEDICAL_FILE_BYTES,
  fileAccessEventSchema,
  lastAccessOf,
  validateMedicalFile,
  type FileAccessEvent,
} from './files';

const event = (over: Partial<FileAccessEvent> = {}): FileAccessEvent =>
  fileAccessEventSchema.parse({
    id: 'fa-1',
    caseRef: 'MIR-2026-0417',
    studyId: 'study-1',
    actorDisplayName: 'Dr. Amal',
    actorSide: 'source',
    action: 'uploaded',
    occurredAt: '2026-08-01T09:00:00.000Z',
    ...over,
  });

describe('file access trail (§5.4 P1, §4.4)', () => {
  it('records the four actions a user can be told about', () => {
    expect([...FILE_ACCESS_ACTIONS]).toEqual(['uploaded', 'viewed', 'downloaded', 'replaced']);
  });

  it('reports the most recent access for a study, not the first', () => {
    const events = [
      event({ id: 'fa-1', occurredAt: '2026-08-01T09:00:00.000Z' }),
      event({
        id: 'fa-2',
        occurredAt: '2026-08-05T14:00:00.000Z',
        actorDisplayName: 'Dr. Youssef',
        action: 'viewed',
      }),
      event({ id: 'fa-3', occurredAt: '2026-08-03T10:00:00.000Z', action: 'downloaded' }),
    ];
    expect(lastAccessOf(events, 'study-1')?.id).toBe('fa-2');
  });

  it('does not attribute one study’s access to another', () => {
    const events = [event({ studyId: 'study-2', actorDisplayName: 'Dr. Other' })];
    expect(lastAccessOf(events, 'study-1')).toBeNull();
  });

  it('returns null rather than throwing when a file has never been touched', () => {
    expect(lastAccessOf([], 'study-1')).toBeNull();
  });
});

describe('medical file validation (§5.2 P0)', () => {
  it('accepts DICOM, the format the corridor actually moves', () => {
    expect(validateMedicalFile({ name: 'IM000001.dcm', sizeBytes: 1024 })).toBeNull();
    expect(validateMedicalFile({ name: 'IM000001', sizeBytes: 1024 })).toBeNull();
  });

  it('accepts the report formats that travel alongside imaging', () => {
    for (const name of ['report.pdf', 'scan.jpg', 'scan.jpeg', 'scan.png']) {
      expect(validateMedicalFile({ name, sizeBytes: 2048 })).toBeNull();
    }
  });

  it('refuses an executable however it is dressed up', () => {
    // Clinic staff forward whatever a colleague sent them. A .exe renamed
    // .dcm still fails on content at the API; this stops the honest mistake.
    expect(validateMedicalFile({ name: 'viewer.exe', sizeBytes: 2048 })).toBe('fileTypeNotAllowed');
    expect(validateMedicalFile({ name: 'notes.docx', sizeBytes: 2048 })).toBe('fileTypeNotAllowed');
  });

  it('is case-insensitive about the extension', () => {
    expect(validateMedicalFile({ name: 'IM000001.DCM', sizeBytes: 1024 })).toBeNull();
  });

  it('refuses an empty file, which is a failed export rather than a study', () => {
    expect(validateMedicalFile({ name: 'IM000001.dcm', sizeBytes: 0 })).toBe('fileEmpty');
  });

  it('refuses a file past the ceiling before the upload starts, not after', () => {
    expect(
      validateMedicalFile({ name: 'huge.dcm', sizeBytes: MAX_MEDICAL_FILE_BYTES + 1 }),
    ).toBe('fileTooLarge');
    expect(validateMedicalFile({ name: 'big.dcm', sizeBytes: MAX_MEDICAL_FILE_BYTES })).toBeNull();
  });

  it('returns a dictionary key, never a sentence', () => {
    const reason = validateMedicalFile({ name: 'x.exe', sizeBytes: 1 });
    expect(reason).toMatch(/^[a-z][A-Za-z0-9]*$/);
  });
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DicomValidationError,
  isDicom,
  isLossyTransferSyntax,
  readHeader,
  sha256,
  validate,
} from './index';

/**
 * BUILD_SPEC P6.1 — verified against the real fixtures from P0.2, not against
 * hand-written byte arrays. A validator tested only on synthetic inputs it was
 * written alongside proves very little.
 */

const FIXTURES = resolve(__dirname, '..', '..', '..', 'test-data', 'dicom');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const load = (relDir: string): Uint8Array[] =>
  walk(join(FIXTURES, relDir)).map((p) => new Uint8Array(readFileSync(p)));

const loadOne = (relDir: string): Uint8Array => {
  const files = load(relDir);
  const first = files[0];
  if (first === undefined) throw new Error(`no fixture in ${relDir}`);
  return first;
};

describe('P6.1 fixture contract', () => {
  it('fixture 01 — valid single DICOM: accepted, header parsed', () => {
    const buf = loadOne('01-single-file-ct');
    expect(isDicom(buf)).toBe(true);

    const header = readHeader(buf);
    expect(header.modality).toBe('CT');
    expect(header.studyInstanceUID).toBe('1.3.6.1.4.1.99999.1.101.1');
    expect(header.seriesInstanceUID).toBe('1.3.6.1.4.1.99999.1.101.1.1');
    expect(header.sopInstanceUID).toBe('1.3.6.1.4.1.99999.1.101.1.1.1');
    expect(header.studyDate).toBe('20250114');
    expect(header.transferSyntaxUID).toBe('1.2.840.10008.1.2.1');
    expect(header.isLossy).toBe(false);
  });

  // 30s, not the 5s default, because this test is I/O-bound rather than
  // compute-bound: it reads 120 fixture files, and on a repo checked out on a
  // Windows-mounted path under WSL2 every one of those reads crosses the 9p
  // filesystem boundary. Alone it takes under a second; under `pnpm -r test`,
  // with four packages reading that mount at once, it has been measured at
  // over three — and it does not degrade gracefully, it simply exceeds the
  // deadline and reports as a failure that looks like a parser bug.
  //
  // The assertions are unchanged. This buys headroom for a slow disk, not
  // tolerance for slow code.
  it('fixture 02 — 120-file CT series: all accepted, ONE StudyInstanceUID', { timeout: 30_000 }, () => {
    const files = load('02-ct-series-120');
    expect(files.length).toBe(120);

    const studyUids = new Set<string>();
    const sopUids = new Set<string>();

    for (const buf of files) {
      const header = readHeader(buf);
      expect(header.modality).toBe('CT');
      studyUids.add(header.studyInstanceUID);
      sopUids.add(header.sopInstanceUID);
    }

    // The whole series must resolve to a single study, or P7.4 would split one
    // scan across multiple study records and the doctor would read a fragment.
    expect(studyUids.size).toBe(1);
    // And every instance must be distinct, or the (study_id, sop_uid) unique
    // constraint would silently drop slices as "duplicates".
    expect(sopUids.size).toBe(120);
  });

  it('fixture 03 — MR series: accepted, modality MR', () => {
    const files = load('03-mr-series');
    expect(files.length).toBeGreaterThan(0);
    for (const buf of files) {
      expect(readHeader(buf).modality).toBe('MR');
    }
  });

  it('fixture 04 — corrupt file: REJECTED as malformed, not as not_dicom', () => {
    const buf = loadOne('04-corrupt');

    // It passes the magic-byte check. A validator that only checks magic bytes
    // waves this straight through — which is the failure this fixture exists
    // to catch.
    expect(isDicom(buf)).toBe(true);

    expect(() => readHeader(buf)).toThrow(DicomValidationError);
    const result = validate(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('malformed');
      expect(result.message).toMatch(/could not be parsed/i);
    }
  });

  it('fixture 05 — renamed non-DICOM: rejected by the magic-byte check', () => {
    const buf = loadOne('05-not-dicom');
    expect(isDicom(buf)).toBe(false);

    const result = validate(buf);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_dicom');
  });

  it('fixture 06 — lossy transfer syntax: ACCEPTED but flagged', () => {
    const buf = loadOne('06-lossy-transfer-syntax');
    const header = readHeader(buf);

    // ADR-5: we never produce lossy data, but we must not reject what the
    // clinic already has. Flag it so the receiving doctor knows.
    expect(header.transferSyntaxUID).toBe('1.2.840.10008.1.2.4.50');
    expect(header.isLossy).toBe(true);
  });

  it('fixture 07 — no preamble: rejected with its OWN reason, not not_dicom', () => {
    const buf = loadOne('07-no-preamble');
    expect(isDicom(buf)).toBe(false);

    const result = validate(buf);
    expect(result.ok).toBe(false);
    // Counted separately so we can measure whether real clinics hit this
    // before deciding whether to loosen the preamble rule.
    if (!result.ok) expect(result.reason).toBe('no_preamble');
  });
});

describe('isDicom', () => {
  it('rejects buffers too short to contain a preamble', () => {
    expect(isDicom(new Uint8Array(0))).toBe(false);
    expect(isDicom(new Uint8Array(131))).toBe(false);
  });

  it('rejects a buffer with the right length but wrong magic', () => {
    const buf = new Uint8Array(200);
    buf.set([0x44, 0x49, 0x43, 0x4e], 128); // "DICN"
    expect(isDicom(buf)).toBe(false);
  });

  it('does not look for DICM anywhere except offset 128', () => {
    // A PDF that merely contains the string "DICM" must not be accepted.
    const buf = new Uint8Array(300);
    buf.set([0x44, 0x49, 0x43, 0x4d], 40);
    expect(isDicom(buf)).toBe(false);
  });
});

describe('isLossyTransferSyntax', () => {
  it('identifies lossy syntaxes', () => {
    expect(isLossyTransferSyntax('1.2.840.10008.1.2.4.50')).toBe(true); // JPEG baseline
    expect(isLossyTransferSyntax('1.2.840.10008.1.2.4.51')).toBe(true);
    expect(isLossyTransferSyntax('1.2.840.10008.1.2.4.91')).toBe(true); // JPEG 2000 lossy
    expect(isLossyTransferSyntax('1.2.840.10008.1.2.4.81')).toBe(true); // JPEG-LS lossy
  });

  it('does not flag lossless syntaxes', () => {
    expect(isLossyTransferSyntax('1.2.840.10008.1.2')).toBe(false); // implicit VR LE
    expect(isLossyTransferSyntax('1.2.840.10008.1.2.1')).toBe(false); // explicit VR LE
    expect(isLossyTransferSyntax('1.2.840.10008.1.2.4.70')).toBe(false); // JPEG lossless
    expect(isLossyTransferSyntax('1.2.840.10008.1.2.4.90')).toBe(false); // JPEG 2000 lossless
    expect(isLossyTransferSyntax('1.2.840.10008.1.2.5')).toBe(false); // RLE lossless
  });

  it('handles whitespace-padded and absent values', () => {
    // DICOM UI values are NUL-padded to even length; trailing whitespace is
    // common in the wild.
    expect(isLossyTransferSyntax('1.2.840.10008.1.2.4.50 ')).toBe(true);
    expect(isLossyTransferSyntax(undefined)).toBe(false);
  });
});

describe('sha256', () => {
  it('matches the known digest of the empty input', () => {
    expect(sha256(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('changes when a single byte changes', () => {
    expect(sha256(Uint8Array.from([0, 1, 2]))).not.toBe(sha256(Uint8Array.from([0, 1, 3])));
  });

  it('is stable across repeated calls on real fixture bytes', () => {
    const buf = loadOne('01-single-file-ct');
    expect(sha256(buf)).toBe(sha256(buf));
    expect(sha256(buf)).toHaveLength(64);
  });
});

describe('patient identity from file tags', () => {
  it('exposes PatientID as metadata only, clearly named', () => {
    const buf = loadOne('01-single-file-ct');
    const header = readHeader(buf);

    // The field is `patientIdInFile`, not `patientId`, so a caller cannot use
    // it for record linkage without noticing what they are doing (P6.1).
    expect(header.patientIdInFile).toBe('SYN-0001');
    expect(Object.keys(header)).not.toContain('patientId');
    expect(Object.keys(header)).not.toContain('patientName');
  });
});

describe('validate()', () => {
  it('returns a result instead of throwing, so a batch can continue', () => {
    // P7.4 processes hundreds of files per study; one bad file must not abort
    // the whole ingest.
    const good = validate(loadOne('01-single-file-ct'));
    const bad = validate(loadOne('05-not-dicom'));

    expect(good.ok).toBe(true);
    expect(bad.ok).toBe(false);
    if (good.ok) {
      expect(good.header.modality).toBe('CT');
      expect(good.sha256).toHaveLength(64);
    }
  });
});

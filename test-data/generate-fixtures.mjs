#!/usr/bin/env node
/**
 * Generates the synthetic DICOM fixtures required by BUILD_SPEC P0.2.
 *
 * These files are SYNTHETIC. They are built byte-by-byte by this script and
 * contain no real patient data of any kind (ADR-7). Every PatientName is
 * prefixed `SYNTHETIC^` so the CI guard in `check-synthetic.mjs` can prove it.
 *
 * Why generate instead of downloading TCIA/Orthanc samples (as P0.2 suggests):
 *   - A generated corpus cannot contain real patient data even by accident.
 *   - CI needs no network access and the bytes are identical on every run.
 *   - We need deliberately malformed fixtures (corrupt, non-DICOM, lossy) that
 *     no public dataset ships.
 *
 * Usage: node test-data/generate-fixtures.mjs
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'dicom');

// A deliberately non-registered UID root. These UIDs must never collide with
// anything real, and must be obviously fake on inspection.
const UID_ROOT = '1.3.6.1.4.1.99999.1';

const TS = {
  IMPLICIT_VR_LE: '1.2.840.10008.1.2',
  EXPLICIT_VR_LE: '1.2.840.10008.1.2.1',
  JPEG_BASELINE: '1.2.840.10008.1.2.4.50', // lossy
};

const SOP_CLASS = {
  CT: '1.2.840.10008.5.1.4.1.1.2',
  MR: '1.2.840.10008.5.1.4.1.1.4',
};

// VRs that use the 12-byte explicit header (2-byte reserved + 4-byte length).
const LONG_FORM_VR = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN']);

/** DICOM values must be even length. UI pads with NUL, text VRs pad with space. */
function padEven(s, padChar) {
  return s.length % 2 === 0 ? s : s + padChar;
}

function strValue(vr, s) {
  return Buffer.from(padEven(s, vr === 'UI' ? '\0' : ' '), 'latin1');
}

function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v, 0);
  return b;
}

function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v, 0);
  return b;
}

/** Encode one element in Explicit VR Little Endian. */
function elem(group, element, vr, value) {
  const long = LONG_FORM_VR.has(vr);
  const head = Buffer.alloc(long ? 12 : 8);
  head.writeUInt16LE(group, 0);
  head.writeUInt16LE(element, 2);
  head.write(vr, 4, 'latin1');
  if (long) {
    head.writeUInt16LE(0, 6); // reserved
    head.writeUInt32LE(value.length, 8);
  } else {
    head.writeUInt16LE(value.length, 6);
  }
  return Buffer.concat([head, value]);
}

/** Element with an explicitly supplied (possibly undefined-length) length. */
function elemRawLength(group, element, vr, length, value) {
  const head = Buffer.alloc(12);
  head.writeUInt16LE(group, 0);
  head.writeUInt16LE(element, 2);
  head.write(vr, 4, 'latin1');
  head.writeUInt16LE(0, 6);
  head.writeUInt32LE(length, 8);
  return Buffer.concat([head, value]);
}

function fileMeta({ sopClassUid, sopInstanceUid, transferSyntaxUid }) {
  const body = Buffer.concat([
    elem(0x0002, 0x0001, 'OB', Buffer.from([0x00, 0x01])), // FileMetaInformationVersion
    elem(0x0002, 0x0002, 'UI', strValue('UI', sopClassUid)),
    elem(0x0002, 0x0003, 'UI', strValue('UI', sopInstanceUid)),
    elem(0x0002, 0x0010, 'UI', strValue('UI', transferSyntaxUid)),
    elem(0x0002, 0x0012, 'UI', strValue('UI', `${UID_ROOT}.0.1`)), // ImplementationClassUID
    elem(0x0002, 0x0013, 'SH', strValue('SH', 'MIR_TESTGEN_1')),
  ]);
  // (0002,0000) counts every byte of group 0002 that follows it.
  const groupLength = elem(0x0002, 0x0000, 'UL', u32(body.length));
  return Buffer.concat([groupLength, body]);
}

/** 16-bit grayscale gradient with a moving block, so slices differ from each other. */
function pixelData(rows, cols, slice) {
  const buf = Buffer.alloc(rows * cols * 2);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const base = ((x + slice * 3) % cols) * 16 + ((y % 32) * 8);
      buf.writeUInt16LE(base & 0x0fff, (y * cols + x) * 2);
    }
  }
  return buf;
}

function dataset({ modality, sopClassUid, sopInstanceUid, studyUid, seriesUid, instanceNumber, rows, cols, patientName, patientId, studyDate, description, pixels }) {
  return Buffer.concat([
    elem(0x0008, 0x0016, 'UI', strValue('UI', sopClassUid)),
    elem(0x0008, 0x0018, 'UI', strValue('UI', sopInstanceUid)),
    elem(0x0008, 0x0020, 'DA', strValue('DA', studyDate)),
    elem(0x0008, 0x0030, 'TM', strValue('TM', '101500')),
    elem(0x0008, 0x0060, 'CS', strValue('CS', modality)),
    elem(0x0008, 0x1030, 'LO', strValue('LO', description)),
    elem(0x0010, 0x0010, 'PN', strValue('PN', patientName)),
    elem(0x0010, 0x0020, 'LO', strValue('LO', patientId)),
    elem(0x0010, 0x0030, 'DA', strValue('DA', '19800101')),
    elem(0x0010, 0x0040, 'CS', strValue('CS', 'M')),
    elem(0x0020, 0x000d, 'UI', strValue('UI', studyUid)),
    elem(0x0020, 0x000e, 'UI', strValue('UI', seriesUid)),
    elem(0x0020, 0x0011, 'IS', strValue('IS', '1')),
    elem(0x0020, 0x0013, 'IS', strValue('IS', String(instanceNumber))),
    elem(0x0028, 0x0002, 'US', u16(1)), // SamplesPerPixel
    elem(0x0028, 0x0004, 'CS', strValue('CS', 'MONOCHROME2')),
    elem(0x0028, 0x0010, 'US', u16(rows)),
    elem(0x0028, 0x0011, 'US', u16(cols)),
    elem(0x0028, 0x0100, 'US', u16(16)), // BitsAllocated
    elem(0x0028, 0x0101, 'US', u16(12)), // BitsStored
    elem(0x0028, 0x0102, 'US', u16(11)), // HighBit
    elem(0x0028, 0x0103, 'US', u16(0)), // PixelRepresentation (unsigned)
    elem(0x7fe0, 0x0010, 'OW', pixels),
  ]);
}

function buildFile(opts) {
  const preamble = Buffer.alloc(128, 0);
  const magic = Buffer.from('DICM', 'latin1');
  const meta = fileMeta({
    sopClassUid: opts.sopClassUid,
    sopInstanceUid: opts.sopInstanceUid,
    transferSyntaxUid: TS.EXPLICIT_VR_LE,
  });
  return Buffer.concat([preamble, magic, meta, dataset(opts)]);
}

function writeSeries({ dir, count, modality, sopClassUid, studySeed, rows, cols, patientName, patientId, studyDate, description }) {
  mkdirSync(dir, { recursive: true });
  const studyUid = `${UID_ROOT}.${studySeed}.1`;
  const seriesUid = `${UID_ROOT}.${studySeed}.1.1`;
  let bytes = 0;
  for (let i = 1; i <= count; i++) {
    const sopInstanceUid = `${UID_ROOT}.${studySeed}.1.1.${i}`;
    const file = buildFile({
      modality,
      sopClassUid,
      sopInstanceUid,
      studyUid,
      seriesUid,
      instanceNumber: i,
      rows,
      cols,
      patientName,
      patientId,
      studyDate,
      description,
      pixels: pixelData(rows, cols, i),
    });
    // Extensionless on purpose for the CT series: real clinic CDs frequently
    // ship files with no extension at all (P7.3 folder upload has to cope).
    const name = modality === 'CT' && count > 100
      ? `IM${String(i).padStart(6, '0')}`
      : `${modality}${String(i).padStart(6, '0')}.dcm`;
    const path = join(dir, name);
    writeFileSync(path, file);
    bytes += file.length;
  }
  return { studyUid, seriesUid, count, bytes };
}

// ---------------------------------------------------------------------------

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(ROOT, { recursive: true });

const report = {};

// Fixture 1 — one small single-file study.
report.singleFile = writeSeries({
  dir: join(ROOT, '01-single-file-ct'),
  count: 1,
  modality: 'CT',
  sopClassUid: SOP_CLASS.CT,
  studySeed: 101,
  rows: 64,
  cols: 64,
  patientName: 'SYNTHETIC^SINGLE^^^',
  patientId: 'SYN-0001',
  studyDate: '20250114',
  description: 'SYNTHETIC single-slice CT',
});

// Fixture 2 — multi-file CT series, >100 files, one StudyInstanceUID.
report.ctSeries = writeSeries({
  dir: join(ROOT, '02-ct-series-120'),
  count: 120,
  modality: 'CT',
  sopClassUid: SOP_CLASS.CT,
  studySeed: 102,
  rows: 128,
  cols: 128,
  patientName: 'SYNTHETIC^CTSERIES^^^',
  patientId: 'SYN-0002',
  studyDate: '20250211',
  description: 'SYNTHETIC CT chest 120 slices',
});

// Fixture 3 — MR series.
report.mrSeries = writeSeries({
  dir: join(ROOT, '03-mr-series'),
  count: 24,
  modality: 'MR',
  sopClassUid: SOP_CLASS.MR,
  studySeed: 103,
  rows: 128,
  cols: 128,
  patientName: 'SYNTHETIC^MRSERIES^^^',
  patientId: 'SYN-0003',
  studyDate: '20250305',
  description: 'SYNTHETIC MR brain',
});

// Fixture 4 — deliberately corrupt: valid preamble and DICM magic, then a
// truncated/garbled meta group. Must be rejected by the parser, NOT by the
// magic-byte check — that distinction is what P6.1 tests.
{
  const dir = join(ROOT, '04-corrupt');
  mkdirSync(dir, { recursive: true });
  const good = buildFile({
    modality: 'CT',
    sopClassUid: SOP_CLASS.CT,
    sopInstanceUid: `${UID_ROOT}.104.1.1.1`,
    studyUid: `${UID_ROOT}.104.1`,
    seriesUid: `${UID_ROOT}.104.1.1`,
    instanceNumber: 1,
    rows: 64,
    cols: 64,
    patientName: 'SYNTHETIC^CORRUPT^^^',
    patientId: 'SYN-0004',
    studyDate: '20250401',
    description: 'SYNTHETIC corrupt fixture',
    pixels: pixelData(64, 64, 1),
  });
  const corrupt = Buffer.from(good);
  // Overwrite the file-meta group length with an absurd value and shred the
  // bytes that follow, then truncate mid-dataset.
  corrupt.writeUInt32LE(0x7fffffff, 132 + 8);
  for (let i = 160; i < 400 && i < corrupt.length; i++) corrupt[i] = 0xff;
  const truncated = corrupt.subarray(0, 600);
  writeFileSync(join(dir, 'corrupt.dcm'), truncated);
  report.corrupt = { count: 1, bytes: truncated.length };
}

// Fixture 5 — a non-DICOM file renamed to .dcm. Must fail the magic-byte check.
{
  const dir = join(ROOT, '05-not-dicom');
  mkdirSync(dir, { recursive: true });
  // A real PNG header, so it is genuinely a different format rather than noise.
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('This is a PNG, not a DICOM file. Renamed to .dcm on purpose.', 'latin1'),
    Buffer.alloc(2048, 0x42),
  ]);
  writeFileSync(join(dir, 'actually-a-png.dcm'), png);
  report.notDicom = { count: 1, bytes: png.length };
}

// Fixture 6 (beyond P0.2, needed by P6.1) — declares a LOSSY transfer syntax.
// Per ADR-5 we never produce these, but ingest must detect and flag them.
// The encapsulated fragment is a JPEG SOI/EOI stub: this fixture exists to
// exercise transfer-syntax detection, not image decoding.
{
  const dir = join(ROOT, '06-lossy-transfer-syntax');
  mkdirSync(dir, { recursive: true });
  const sopInstanceUid = `${UID_ROOT}.106.1.1.1`;
  const preamble = Buffer.alloc(128, 0);
  const magic = Buffer.from('DICM', 'latin1');
  const meta = fileMeta({
    sopClassUid: SOP_CLASS.CT,
    sopInstanceUid,
    transferSyntaxUid: TS.JPEG_BASELINE,
  });

  const jpegStub = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.alloc(64, 0x7f),
    Buffer.from([0xff, 0xd9]),
  ]);
  const evenJpeg = jpegStub.length % 2 === 0 ? jpegStub : Buffer.concat([jpegStub, Buffer.alloc(1)]);

  const item = (len, payload) =>
    Buffer.concat([u16(0xfffe), u16(0xe000), u32(len), payload]);

  const encapsulated = Buffer.concat([
    item(0, Buffer.alloc(0)), // empty basic offset table
    item(evenJpeg.length, evenJpeg),
    Buffer.concat([u16(0xfffe), u16(0xe0dd), u32(0)]), // sequence delimiter
  ]);

  // Dataset elements are still Explicit VR LE; only the pixel data is encoded
  // with the lossy syntax, which is how DICOM actually works.
  const head = Buffer.concat([
    elem(0x0008, 0x0016, 'UI', strValue('UI', SOP_CLASS.CT)),
    elem(0x0008, 0x0018, 'UI', strValue('UI', sopInstanceUid)),
    elem(0x0008, 0x0020, 'DA', strValue('DA', '20250501')),
    elem(0x0008, 0x0060, 'CS', strValue('CS', 'CT')),
    elem(0x0008, 0x1030, 'LO', strValue('LO', 'SYNTHETIC lossy-encoded CT')),
    elem(0x0010, 0x0010, 'PN', strValue('PN', 'SYNTHETIC^LOSSY^^^')),
    elem(0x0010, 0x0020, 'LO', strValue('LO', 'SYN-0006')),
    elem(0x0020, 0x000d, 'UI', strValue('UI', `${UID_ROOT}.106.1`)),
    elem(0x0020, 0x000e, 'UI', strValue('UI', `${UID_ROOT}.106.1.1`)),
    elem(0x0028, 0x0002, 'US', u16(1)),
    elem(0x0028, 0x0004, 'CS', strValue('CS', 'MONOCHROME2')),
    elem(0x0028, 0x0010, 'US', u16(64)),
    elem(0x0028, 0x0011, 'US', u16(64)),
    elem(0x0028, 0x0100, 'US', u16(8)),
    elem(0x0028, 0x0101, 'US', u16(8)),
    elem(0x0028, 0x0102, 'US', u16(7)),
    elem(0x0028, 0x0103, 'US', u16(0)),
  ]);

  const pixelElem = elemRawLength(0x7fe0, 0x0010, 'OB', 0xffffffff, encapsulated);
  const file = Buffer.concat([preamble, magic, meta, head, pixelElem]);
  writeFileSync(join(dir, 'lossy-jpeg.dcm'), file);
  report.lossy = { count: 1, bytes: file.length };
}

// Fixture 7 (beyond P0.2, needed by P6.1) — valid DICOM dataset with NO 128-byte
// preamble and no DICM magic. Legacy scanners emit these. P6.1 requires we
// reject them but log them distinctly as `rejected_no_preamble` so we can
// measure whether real clinics hit this before loosening the rule.
{
  const dir = join(ROOT, '07-no-preamble');
  mkdirSync(dir, { recursive: true });
  const full = buildFile({
    modality: 'CT',
    sopClassUid: SOP_CLASS.CT,
    sopInstanceUid: `${UID_ROOT}.107.1.1.1`,
    studyUid: `${UID_ROOT}.107.1`,
    seriesUid: `${UID_ROOT}.107.1.1`,
    instanceNumber: 1,
    rows: 64,
    cols: 64,
    patientName: 'SYNTHETIC^NOPREAMBLE^^^',
    patientId: 'SYN-0007',
    studyDate: '20250601',
    description: 'SYNTHETIC no-preamble CT',
    pixels: pixelData(64, 64, 1),
  });
  // Strip the 128-byte preamble and the 4-byte DICM magic.
  const stripped = full.subarray(132);
  writeFileSync(join(dir, 'no-preamble.dcm'), stripped);
  report.noPreamble = { count: 1, bytes: stripped.length };
}

const total = Object.values(report).reduce((a, r) => a + r.bytes, 0);
const files = Object.values(report).reduce((a, r) => a + r.count, 0);

console.log(JSON.stringify({ ...report, TOTAL: { count: files, bytes: total } }, null, 2));
console.log(`\n${files} files, ${(total / 1024 / 1024).toFixed(2)} MiB total`);

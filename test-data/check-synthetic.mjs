#!/usr/bin/env node
/**
 * CI guard for BUILD_SPEC P0.2 step 2 and ADR-7.
 *
 * Fails the build if any file under test-data/ carries a PatientName that is
 * not on the synthetic allowlist.
 *
 * This is an ALLOWLIST, not a denylist of real-looking names. A denylist can
 * only catch names someone thought to enumerate; an allowlist fails closed on
 * anything unexpected, which is the only useful posture when the failure mode
 * is "real patient data reached the repository".
 *
 * Dependency-free on purpose: it must be runnable in CI before (and
 * independently of) any workspace install.
 *
 * Usage: node test-data/check-synthetic.mjs
 * Exit:  0 = clean, 1 = violation found
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DATA = dirname(fileURLToPath(import.meta.url));

/** Every PatientName in test-data must match one of these. */
const ALLOWED_PATIENT_NAME = /^SYNTHETIC\^[A-Z0-9]+\^*$/;

/** Files that are intentionally not DICOM and are skipped by the tag scan. */
const NON_DICOM_FIXTURES = [/05-not-dicom/];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * Extract every PatientName (0010,0010) value by raw byte scan.
 *
 * Handles both Explicit VR Little Endian (tag + "PN" + uint16 length) and
 * Implicit VR Little Endian (tag + uint32 length), because we cannot assume
 * which encoding a dropped-in file uses.
 */
function extractPatientNames(buf) {
  const names = [];
  for (let i = 0; i + 8 <= buf.length; i++) {
    // Tag (0010,0010) in little endian: 10 00 10 00
    if (buf[i] === 0x10 && buf[i + 1] === 0x00 && buf[i + 2] === 0x10 && buf[i + 3] === 0x00) {
      const vr = buf.toString('latin1', i + 4, i + 6);
      let valueStart;
      let length;
      if (vr === 'PN') {
        valueStart = i + 8;
        length = buf.readUInt16LE(i + 6);
      } else {
        // Assume implicit VR: 4-byte length follows the tag directly.
        valueStart = i + 8;
        length = buf.readUInt32LE(i + 4);
      }
      if (length > 0 && length < 512 && valueStart + length <= buf.length) {
        names.push(buf.toString('latin1', valueStart, valueStart + length).trim());
      }
    }
  }
  return names;
}

if (!existsSync(join(TEST_DATA, 'dicom'))) {
  console.error('FAIL: test-data/dicom/ does not exist. Run: node test-data/generate-fixtures.mjs');
  process.exit(1);
}

const violations = [];
let scanned = 0;
let namesChecked = 0;

for (const path of walk(join(TEST_DATA, 'dicom'))) {
  const rel = relative(TEST_DATA, path);
  if (NON_DICOM_FIXTURES.some((re) => re.test(rel))) continue;

  scanned++;
  const buf = readFileSync(path);
  const names = extractPatientNames(buf);

  for (const name of names) {
    namesChecked++;
    if (!ALLOWED_PATIENT_NAME.test(name)) {
      violations.push({ file: rel, name });
    }
  }
}

if (violations.length > 0) {
  console.error('FAIL: non-synthetic PatientName found in test-data/\n');
  console.error('ADR-7: real patient data must never leave production. If any of these');
  console.error('are real, treat this as a data incident, not a test failure.\n');
  for (const v of violations) {
    console.error(`  ${v.file}\n    PatientName: ${JSON.stringify(v.name)}`);
  }
  console.error(`\nAllowed pattern: ${ALLOWED_PATIENT_NAME}`);
  process.exit(1);
}

if (namesChecked === 0) {
  console.error('FAIL: scanned files but found zero PatientName tags.');
  console.error('The guard is not actually inspecting anything — treat as broken, not passing.');
  process.exit(1);
}

console.log(`OK: ${scanned} files scanned, ${namesChecked} PatientName values, all synthetic.`);

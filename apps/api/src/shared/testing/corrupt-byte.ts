/**
 * Flip one byte, for the tests that prove corrupted uploads are rejected.
 *
 * WHY A HELPER RATHER THAN `buf[i] ^= 0xff` AT EACH SITE.
 * `noUncheckedIndexedAccess` types `buf[i]` as `number | undefined`, so the
 * direct form does not compile. The two obvious workarounds are both worse
 * than they look:
 *
 *   `buf[i]!  ^= 0xff`      — asserts away exactly the check the flag exists
 *                             for (see the note in tsconfig.base.json about
 *                             `files[0]` on an empty DICOM series).
 *   `buf[i] = (buf[i] ?? 0) ^ 0xff` — compiles, and silently does NOTHING on an
 *                             empty buffer. A corruption test whose corruption
 *                             never happened PASSES, because the upload it was
 *                             meant to break now succeeds. That is a test
 *                             reporting a guarantee it did not check.
 *
 * So the range is checked once, here, and an out-of-range index throws.
 */
export function corruptByte<T extends Uint8Array>(buffer: T, index: number): T {
  const current = buffer[index];
  if (current === undefined) {
    throw new RangeError(
      `cannot corrupt byte ${index} of a ${buffer.length}-byte buffer — ` +
        'the fixture is empty or shorter than the test assumes',
    );
  }
  buffer[index] = current ^ 0xff;
  return buffer;
}

/** Flip the middle byte — the usual "somewhere in transit" corruption. */
export function corruptMiddleByte<T extends Uint8Array>(buffer: T): T {
  return corruptByte(buffer, Math.floor(buffer.length / 2));
}

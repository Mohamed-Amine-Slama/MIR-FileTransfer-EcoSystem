import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ThumbnailService, ThumbnailUnsupportedError } from './internal/thumbnail.service';

/**
 * Thumbnail generation, feeding the P9.1 "first image under 5 seconds" gate.
 *
 * Verified against the real P0.2 fixtures — a generator tested only on
 * hand-made input proves nothing about what a scanner actually emits.
 */

const FIXTURES = join(__dirname, '..', '..', '..', '..', '..', 'test-data', 'dicom');

function loadOne(dir: string): Uint8Array {
  const base = join(FIXTURES, dir);
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((e) => {
      const p = join(d, e);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const first = walk(base)[0];
  if (first === undefined) throw new Error(`no fixture in ${dir}`);
  return new Uint8Array(readFileSync(first));
}

const service = new ThumbnailService();

describe('thumbnail generation', () => {
  it('produces a small JPEG from an uncompressed CT slice', async () => {
    const result = await service.generate(loadOne('01-single-file-ct'));

    // JPEG magic bytes.
    expect(result.bytes[0]).toBe(0xff);
    expect(result.bytes[1]).toBe(0xd8);

    const meta = await sharp(Buffer.from(result.bytes)).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBeLessThanOrEqual(256);
    expect(meta.height).toBeLessThanOrEqual(256);
  });

  it('is small enough to render fast on a 2 Mbit/s link (P9.1)', async () => {
    const result = await service.generate(loadOne('02-ct-series-120'));

    // 2 Mbit/s is 256 KB/s. The budget for first paint is 5 seconds TOTAL,
    // shared with the HTML, the JS bundle and TLS setup — so the image itself
    // must be a small fraction of that. 40 KB is ~0.16s of transfer.
    expect(result.bytes.byteLength).toBeLessThan(40 * 1024);
    expect(result.bytes.byteLength).toBeGreaterThan(200); // not an empty file
  });

  it('renders MR slices too', async () => {
    const result = await service.generate(loadOne('03-mr-series'));
    const meta = await sharp(Buffer.from(result.bytes)).metadata();
    expect(meta.format).toBe('jpeg');
  });

  it('produces a visibly non-uniform image, not a black rectangle', async () => {
    // A window/level bug renders everything to 0 and the failure looks exactly
    // like a broken image load. Check the pixels actually vary.
    const result = await service.generate(loadOne('01-single-file-ct'));
    const { data } = await sharp(Buffer.from(result.bytes))
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const values = new Set<number>();
    for (let i = 0; i < data.length; i += 7) values.add(data[i] ?? 0);
    expect(values.size).toBeGreaterThan(10);
  });

  it('refuses a compressed transfer syntax rather than emitting a wrong image', async () => {
    // A missing thumbnail slows first paint. A WRONG thumbnail shows the
    // doctor the wrong picture — so half-supporting codecs is not acceptable.
    await expect(service.generate(loadOne('06-lossy-transfer-syntax'))).rejects.toThrow(
      ThumbnailUnsupportedError,
    );
  });

  it('rejects a corrupt file rather than producing garbage', async () => {
    await expect(service.generate(loadOne('04-corrupt'))).rejects.toThrow();
  });
});

import { Injectable, Logger } from '@nestjs/common';
import dicomParser from 'dicom-parser';
import sharp from 'sharp';

/**
 * Thumbnail generation — BUILD_SPEC P7.4 step 7, feeding P9.1.
 *
 * P9.1 requires the first image on screen within 5 seconds over a 2 Mbit/s
 * link with 200 ms latency. A full DICOM frame cannot meet that: a 512x512
 * 16-bit slice is 512 KB before overhead, which is ~2 seconds of transfer on
 * its own, before the viewer bundle has even loaded. So the first thing the
 * doctor sees is a small JPEG generated here at ingest time, and Cornerstone3D
 * loads full-fidelity frames behind it, on demand.
 *
 * THIS IS NOT A DIAGNOSTIC IMAGE. It is 8-bit, window-levelled by a crude
 * heuristic, and downsampled. It exists so the viewer has something to show
 * immediately and so study lists are browsable. The persistent banner in the
 * viewer says exactly this, and the platform's positioning (§1.3) depends on
 * the distinction being maintained.
 *
 * ADR-4/ADR-5 are not violated: this writes a SEPARATE derived object. The
 * original is never re-encoded, never modified, and never replaced.
 */

const THUMBNAIL_MAX_DIMENSION = 256;
const JPEG_QUALITY = 70;

export interface ThumbnailResult {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Transfer syntaxes whose pixel data is stored uncompressed. */
const UNCOMPRESSED = new Set([
  '1.2.840.10008.1.2', // Implicit VR Little Endian
  '1.2.840.10008.1.2.1', // Explicit VR Little Endian
  '1.2.840.10008.1.2.1.99', // Deflated Explicit VR LE
  '1.2.840.10008.1.2.2', // Explicit VR Big Endian
]);

export class ThumbnailUnsupportedError extends Error {
  constructor(reason: string) {
    super(`Thumbnail not generated: ${reason}`);
    this.name = 'ThumbnailUnsupportedError';
  }
}

@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name);

  /**
   * Render a small JPEG preview of a DICOM instance.
   *
   * Handles uncompressed pixel data only. Compressed syntaxes (JPEG, JPEG2000,
   * HEVC) would need a codec; rather than pull one in and half-support it, they
   * are reported as unsupported so the caller records the gap instead of
   * writing a broken image. A missing thumbnail degrades the viewer's first
   * paint; a WRONG thumbnail shows the doctor the wrong picture.
   */
  async generate(dicomBytes: Uint8Array): Promise<ThumbnailResult> {
    const dataSet = dicomParser.parseDicom(dicomBytes);

    const transferSyntax = dataSet.string('x00020010')?.trim() ?? '1.2.840.10008.1.2';
    if (!UNCOMPRESSED.has(transferSyntax)) {
      throw new ThumbnailUnsupportedError(`compressed transfer syntax ${transferSyntax}`);
    }

    const rows = dataSet.uint16('x00280010');
    const cols = dataSet.uint16('x00280011');
    const bitsAllocated = dataSet.uint16('x00280100') ?? 16;
    const pixelRepresentation = dataSet.uint16('x00280103') ?? 0; // 0 = unsigned
    const samplesPerPixel = dataSet.uint16('x00280002') ?? 1;
    const photometric = dataSet.string('x00280004')?.trim() ?? 'MONOCHROME2';

    if (rows === undefined || cols === undefined || rows === 0 || cols === 0) {
      throw new ThumbnailUnsupportedError('missing Rows/Columns');
    }
    if (samplesPerPixel !== 1) {
      throw new ThumbnailUnsupportedError(`samplesPerPixel=${samplesPerPixel} (colour) unsupported`);
    }

    const pixelElement = dataSet.elements['x7fe00010'];
    if (pixelElement === undefined) {
      throw new ThumbnailUnsupportedError('no PixelData element');
    }

    const grey = extractGreyscale(dicomBytes, pixelElement, rows, cols, bitsAllocated, pixelRepresentation);

    // MONOCHROME1 means low value = white; invert so it looks right.
    if (photometric === 'MONOCHROME1') {
      for (let i = 0; i < grey.length; i++) grey[i] = 255 - (grey[i] ?? 0);
    }

    const image = sharp(Buffer.from(grey), {
      raw: { width: cols, height: rows, channels: 1 },
    }).resize(THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    const bytes = await image.jpeg({ quality: JPEG_QUALITY, progressive: true }).toBuffer();
    const meta = await sharp(bytes).metadata();

    return {
      bytes: new Uint8Array(bytes),
      width: meta.width ?? cols,
      height: meta.height ?? rows,
    };
  }
}

/**
 * Convert raw pixel data to an 8-bit greyscale buffer.
 *
 * Uses a min/max window rather than the file's WindowCenter/WindowWidth. Those
 * tags are frequently absent or wrong in exported studies, and a thumbnail
 * that renders as a black rectangle is indistinguishable from a failed load.
 * A full-range stretch always produces something recognisable — which is all a
 * preview needs to do.
 */
function extractGreyscale(
  buffer: Uint8Array,
  element: { dataOffset: number; length: number },
  rows: number,
  cols: number,
  bitsAllocated: number,
  pixelRepresentation: number,
): Uint8Array {
  const pixelCount = rows * cols;
  const out = new Uint8Array(pixelCount);

  const view = new DataView(buffer.buffer, buffer.byteOffset + element.dataOffset, element.length);
  const signed = pixelRepresentation === 1;

  const read = (i: number): number => {
    if (bitsAllocated === 8) {
      return signed ? view.getInt8(i) : view.getUint8(i);
    }
    const offset = i * 2;
    return signed ? view.getInt16(offset, true) : view.getUint16(offset, true);
  };

  const available = bitsAllocated === 8 ? element.length : Math.floor(element.length / 2);
  const count = Math.min(pixelCount, available);

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const v = read(i);
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // A uniform image would divide by zero; render it mid-grey instead.
  const range = max - min;
  if (!Number.isFinite(range) || range <= 0) {
    out.fill(128);
    return out;
  }

  for (let i = 0; i < count; i++) {
    out[i] = Math.round(((read(i) - min) / range) * 255);
  }
  return out;
}

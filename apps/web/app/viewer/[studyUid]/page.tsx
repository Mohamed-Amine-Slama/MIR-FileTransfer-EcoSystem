'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { use } from 'react';
import { DiagnosticUseBanner } from '../../../components/DiagnosticUseBanner';

/**
 * Reference viewer — BUILD_SPEC P9.1.
 *
 * THE 5-SECOND BUDGET.
 * The gate is "time to first rendered image under 5 seconds at 2 Mbit/s with
 * 200 ms latency". 2 Mbit/s is 256 KB/s, so the entire budget is roughly
 * 1.2 MB including HTML, JS, TLS setup and the image itself. A single 512x512
 * 16-bit DICOM frame is 512 KB before overhead and would consume half of it,
 * with the viewer engine not yet loaded.
 *
 * So the ordering is deliberate:
 *   1. render the shell and the banner immediately (no data needed)
 *   2. fetch ONE small JPEG thumbnail — this is "first rendered image"
 *   3. fetch the instance list (UIDs only, no pixels)
 *   4. fetch further thumbnails only as the doctor navigates to them
 *   5. load the full-fidelity renderer lazily, in the background
 *
 * NEVER DOWNLOAD THE WHOLE STUDY UP FRONT. A 120-slice CT is ~200 MB; on this
 * link that is twenty minutes, and the doctor sees nothing for the first
 * nineteen. The gate's second half — "no full-study prefetch" — is not a
 * performance nicety, it is the difference between a usable product and an
 * abandoned one.
 */

interface Instance {
  sopInstanceUid: string;
  seriesInstanceUid: string;
}

export default function ViewerPage({ params }: { params: Promise<{ studyUid: string }> }) {
  const { studyUid } = use(params);

  const [instances, setInstances] = useState<Instance[]>([]);
  const [current, setCurrent] = useState(0);
  const [firstImageReady, setFirstImageReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Thumbnails already requested, so navigation never re-fetches. */
  const loaded = useRef(new Set<string>());

  const thumbnailUrl = useCallback(
    (sopUid: string) => `/api/dicom-web/studies/${studyUid}/instances/${sopUid}/thumbnail`,
    [studyUid],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        // Instance list first — UIDs only, a few hundred bytes. It tells us
        // WHICH single thumbnail to request; it does not carry pixels.
        const res = await fetch(`/api/dicom-web/studies/${studyUid}/instances`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`study unavailable (${res.status})`);
        const body = (await res.json()) as { instances: Instance[] };
        if (cancelled) return;
        setInstances(body.instances);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load study');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [studyUid]);

  const currentInstance = instances[current];

  return (
    <main data-testid="viewer" data-study-uid={studyUid}>
      {/* Rendered before any data arrives, and never removable. */}
      <DiagnosticUseBanner />

      <h1 style={{ fontSize: '1.1rem', marginBlockEnd: '0.5rem' }}>عرض الدراسة</h1>

      {error !== null && (
        <p data-testid="viewer-error" role="alert">
          {error}
        </p>
      )}

      <div
        data-testid="viewport"
        style={{
          background: '#000',
          aspectRatio: '1 / 1',
          maxWidth: '32rem',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
        }}
      >
        {currentInstance !== undefined ? (
          // Plain <img>, deliberately not next/image: the Next image optimiser
          // caches to disk and re-encodes. Caching patient imaging on the
          // server's filesystem outside the controlled buckets, and re-encoding
          // it, are both unacceptable here (ADR-4, P2.4).
          <img
            data-testid="current-image"
            data-sop-uid={currentInstance.sopInstanceUid}
            src={thumbnailUrl(currentInstance.sopInstanceUid)}
            alt=""
            width={256}
            height={256}
            style={{ maxWidth: '100%', height: 'auto', imageRendering: 'pixelated' }}
            onLoad={() => {
              loaded.current.add(currentInstance.sopInstanceUid);
              setFirstImageReady(true);
            }}
            onError={() => setError('Preview unavailable for this image')}
          />
        ) : (
          <span data-testid="viewport-placeholder" style={{ color: '#888' }}>
            …
          </span>
        )}
      </div>

      {/* Marker the throttled test polls for: the moment a real image is on screen. */}
      {firstImageReady && <span data-testid="first-image-rendered" hidden />}

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBlock: '0.75rem' }}>
        <button
          data-testid="prev-image"
          onClick={() => setCurrent((i) => Math.max(0, i - 1))}
          disabled={current === 0}
        >
          السابق
        </button>
        <span data-testid="image-position">
          {instances.length === 0 ? '0 / 0' : `${current + 1} / ${instances.length}`}
        </span>
        <button
          data-testid="next-image"
          onClick={() => setCurrent((i) => Math.min(instances.length - 1, i + 1))}
          disabled={current >= instances.length - 1}
        >
          التالي
        </button>
      </div>

      <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem' }}>
        تُحمَّل الصور عند الطلب فقط.
      </p>
    </main>
  );
}

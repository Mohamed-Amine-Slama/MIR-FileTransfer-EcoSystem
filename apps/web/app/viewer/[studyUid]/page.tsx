'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { DiagnosticUseBanner } from '../../../components/DiagnosticUseBanner';
import { canRenderFullFidelity, type CornerstoneViewer } from '../../../lib/viewer/cornerstone';

/**
 * Reference viewer — BUILD_SPEC P9.1.
 *
 * THE 5-SECOND BUDGET SHAPES THE LOAD ORDER.
 * The gate is "time to first rendered image under 5 seconds at 2 Mbit/s with
 * 200 ms latency" — roughly 1.2 MB total, including HTML, JS and TLS setup.
 * Cornerstone3D plus vtk.js exceeds that on its own, so it cannot be in the
 * critical path.
 *
 *   1. render the shell and the banner immediately (no data needed)
 *   2. fetch the instance list — UIDs only, no pixels
 *   3. fetch ONE small JPEG thumbnail — this is "first rendered image"
 *   4. THEN dynamically import Cornerstone and upgrade to full fidelity
 *   5. further frames load only as the doctor navigates to them
 *
 * If step 4 never completes — slow link, no WebGL, old browser — the doctor
 * keeps a usable reference image instead of an empty pane. Degrading to the
 * thumbnail is a feature, not a fallback nobody tested: the e2e suite asserts
 * the first-paint path still meets the gate.
 *
 * NEVER DOWNLOAD THE WHOLE STUDY UP FRONT. A 120-slice CT is ~200 MB; on this
 * link that is twenty minutes with nothing on screen for nineteen of them.
 */

interface Instance {
  sopInstanceUid: string;
  seriesInstanceUid: string;
}

type Fidelity = 'thumbnail' | 'loading-full' | 'full' | 'unavailable';

export default function ViewerPage({ params }: { params: Promise<{ studyUid: string }> }) {
  const { studyUid } = use(params);

  const [instances, setInstances] = useState<Instance[]>([]);
  const [current, setCurrent] = useState(0);
  const [firstImageReady, setFirstImageReady] = useState(false);
  const [fidelity, setFidelity] = useState<Fidelity>('thumbnail');
  const [error, setError] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<CornerstoneViewer | null>(null);

  const thumbnailUrl = useCallback(
    (sopUid: string) => `/api/dicom-web/studies/${studyUid}/instances/${sopUid}/thumbnail`,
    [studyUid],
  );

  // --- step 2: instance list (UIDs only) ------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/dicom-web/studies/${studyUid}/instances`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`study unavailable (${res.status})`);
        const body = (await res.json()) as { instances: Instance[] };
        if (!cancelled) setInstances(body.instances);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load study');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studyUid]);

  // --- step 4: upgrade to full fidelity, AFTER the thumbnail is on screen ---
  useEffect(() => {
    if (!firstImageReady || fidelity !== 'thumbnail') return;
    if (!canRenderFullFidelity()) {
      // No WebGL2. Do not download a megabyte that can only fail.
      setFidelity('unavailable');
      return;
    }

    let cancelled = false;
    setFidelity('loading-full');

    void (async () => {
      try {
        const { createViewer } = await import('../../../lib/viewer/cornerstone');
        const element = viewportRef.current;
        if (cancelled || element === null) return;

        const viewer = await createViewer({ element, studyUid });
        if (cancelled) {
          viewer.destroy();
          return;
        }
        viewerRef.current = viewer;

        const instance = instances[current];
        if (instance !== undefined) await viewer.showInstance(instance.sopInstanceUid);
        if (!cancelled) setFidelity('full');
      } catch {
        // Keep the thumbnail. A viewer that fails to upgrade is still a
        // viewer; a blank viewport is not.
        if (!cancelled) setFidelity('unavailable');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [firstImageReady, fidelity, instances, current, studyUid]);

  // --- navigation: one frame at a time, never a prefetch --------------------
  useEffect(() => {
    if (fidelity !== 'full') return;
    const viewer = viewerRef.current;
    const instance = instances[current];
    if (viewer === null || instance === undefined) return;
    void viewer.showInstance(instance.sopInstanceUid).catch(() => setFidelity('unavailable'));
  }, [current, fidelity, instances]);

  useEffect(
    () => () => {
      viewerRef.current?.destroy();
      viewerRef.current = null;
    },
    [],
  );

  const currentInstance = instances[current];
  const showThumbnail = fidelity !== 'full';

  return (
    <main data-testid="viewer" data-study-uid={studyUid} data-fidelity={fidelity}>
      {/* Rendered before any data arrives, and never removable. */}
      <DiagnosticUseBanner />

      <h1 style={{ fontSize: '1.1rem', marginBlockEnd: '0.5rem' }}>عرض الدراسة</h1>

      {error !== null && (
        <p data-testid="viewer-error" role="alert">
          {error}
        </p>
      )}

      <div
        style={{
          position: 'relative',
          background: '#000',
          aspectRatio: '1 / 1',
          maxWidth: '32rem',
          overflow: 'hidden',
        }}
      >
        {/* Cornerstone renders here once loaded. Kept mounted so the canvas
            has a stable element to attach to. */}
        <div
          ref={viewportRef}
          data-testid="cornerstone-viewport"
          style={{ position: 'absolute', inset: 0, opacity: fidelity === 'full' ? 1 : 0 }}
        />

        {showThumbnail && currentInstance !== undefined && (
          // Plain <img>, deliberately not next/image: the Next image optimiser
          // caches to disk and re-encodes. Caching patient imaging outside the
          // controlled buckets, and re-encoding it, are both unacceptable
          // (ADR-4, P2.4).
          <img
            data-testid="current-image"
            data-sop-uid={currentInstance.sopInstanceUid}
            src={thumbnailUrl(currentInstance.sopInstanceUid)}
            alt=""
            width={256}
            height={256}
            style={{
              position: 'absolute',
              inset: 0,
              margin: 'auto',
              maxWidth: '100%',
              height: 'auto',
              imageRendering: 'pixelated',
            }}
            onLoad={() => setFirstImageReady(true)}
            onError={() => setError('Preview unavailable for this image')}
          />
        )}

        {currentInstance === undefined && (
          <span
            data-testid="viewport-placeholder"
            style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#888' }}
          >
            …
          </span>
        )}
      </div>

      {/* Marker the throttled test polls for: a real image is on screen. */}
      {firstImageReady && <span data-testid="first-image-rendered" hidden />}
      {fidelity === 'full' && <span data-testid="full-fidelity-rendered" hidden />}

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

        <span data-testid="fidelity-label" style={{ color: 'var(--color-muted)', fontSize: '0.85rem' }}>
          {fidelity === 'full'
            ? 'دقة كاملة'
            : fidelity === 'loading-full'
              ? 'جارٍ تحميل الدقة الكاملة…'
              : fidelity === 'unavailable'
                ? 'معاينة فقط'
                : 'معاينة'}
        </span>
      </div>

      {fidelity === 'full' && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBlockEnd: '0.75rem' }}>
          {/* Window presets. Values are conventional CT ranges; the doctor is
              judging whether to open this on their workstation, not reading. */}
          <button data-testid="window-soft" onClick={() => viewerRef.current?.setWindow(40, 400)}>
            أنسجة رخوة
          </button>
          <button data-testid="window-lung" onClick={() => viewerRef.current?.setWindow(-600, 1500)}>
            رئة
          </button>
          <button data-testid="window-bone" onClick={() => viewerRef.current?.setWindow(300, 1500)}>
            عظام
          </button>
          <button data-testid="window-reset" onClick={() => viewerRef.current?.resetWindow()}>
            إعادة تعيين
          </button>
        </div>
      )}

      <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem' }}>
        تُحمَّل الصور عند الطلب فقط.
      </p>
    </main>
  );
}

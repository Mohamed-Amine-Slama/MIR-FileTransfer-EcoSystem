import { describe, expect, it } from 'vitest';
import { REDACTED } from './log-scrubber';
import {
  InMemorySpanExporter,
  Tracer,
  normaliseRoute,
  sanitiseAttributes, OtlpSpanExporter } from './tracing';

/**
 * BUILD_SPEC PHASE 13 item 1 — traces across API → DB → Orthanc → S3.
 *
 * The property under test is not "spans are produced" but "spans carry no
 * patient data". A trace goes to the same collector as logs, is read by the
 * same people, and is retained just as long.
 */

describe('PHASE 13 tracing', () => {
  it('links child spans to their parent trace', async () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer(exporter);

    const request = tracer.startSpan('GET /patients/:id', 'server', {});
    await tracer.inSpan('postgres.query', 'client', { 'db.system': 'postgresql' }, async () => 1, {
      traceId: request.traceId,
      spanId: request.spanId,
    });
    tracer.endSpan(request);

    expect(exporter.spans).toHaveLength(2);
    const [child, parent] = exporter.spans;
    expect(child?.traceId).toBe(parent?.traceId);
    expect(child?.parentSpanId).toBe(parent?.spanId);
  });

  it('records an error status without leaking the error contents', async () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer(exporter);
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.aaaaaaaaaaaaaaaa';

    await expect(
      tracer.inSpan('orthanc.retrieve', 'client', {}, async () => {
        throw new Error(`auth failed with ${token}`);
      }),
    ).rejects.toThrow();

    const span = exporter.spans[0];
    expect(span?.status).toBe('error');
    expect(span?.error ?? '').not.toContain(token);
  });

  it('never records db.statement — the default that leaks bound parameters', () => {
    // OTel's Postgres instrumentation records full SQL including parameters,
    // which here means patient ids and phone numbers going to the collector.
    const attrs = sanitiseAttributes({
      'db.system': 'postgresql',
      'db.statement': "SELECT * FROM patients_patients WHERE phone_e164 = '+218912345678'",
      'db.operation': 'SELECT',
    });

    expect(attrs['db.statement']).toBeUndefined();
    expect(attrs['db.system']).toBe('postgresql');
    expect(attrs['db.operation']).toBe('SELECT');
  });

  it('scrubs sensitive values that reach an attribute anyway', () => {
    const attrs = sanitiseAttributes({
      'user.phone': '+218912345678',
      'http.route': '/patients',
    });
    expect(String(attrs['user.phone'])).toBe(REDACTED);
    expect(attrs['http.route']).toBe('/patients');
  });

  it('normalises identifiers out of route names', () => {
    // Span names are the one field every tracing UI indexes and displays. A
    // raw path would put a patient id in front of everyone.
    expect(normaliseRoute('/patients/018f8e6a-0000-7000-8000-000000000001/claim-token')).toBe(
      '/patients/:id/claim-token',
    );
    expect(
      normaliseRoute('/dicom-web/studies/1.3.6.1.4.1.99999.1.101.1/metadata'),
    ).toBe('/dicom-web/studies/:uid/metadata');
    expect(normaliseRoute('/patients')).toBe('/patients');
  });

  it('measures duration', async () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer(exporter);
    await tracer.inSpan('s3.putObject', 'client', {}, async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
    const span = exporter.spans[0];
    expect((span?.endedAt ?? 0) - (span?.startedAt ?? 0)).toBeGreaterThanOrEqual(10);
  });

  it('covers the four hops PHASE 13 names', async () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer(exporter);

    const root = tracer.startSpan('GET /dicom-web/studies/:uid', 'server', {});
    const parent = { traceId: root.traceId, spanId: root.spanId };

    for (const [name, attrs] of [
      ['postgres.query', { 'db.system': 'postgresql' }],
      ['orthanc.retrieve', { 'peer.service': 'orthanc' }],
      ['s3.getObject', { 'peer.service': 's3' }],
    ] as const) {
      await tracer.inSpan(name, 'client', attrs, async () => undefined, parent);
    }
    tracer.endSpan(root);

    // API → DB → Orthanc → S3, all under one trace id.
    const ids = new Set(exporter.spans.map((s) => s.traceId));
    expect(ids.size).toBe(1);
    expect(exporter.spans.map((s) => s.name)).toEqual([
      'postgres.query',
      'orthanc.retrieve',
      's3.getObject',
      'GET /dicom-web/studies/:uid',
    ]);
  });
})

describe('PHASE 13 — spans actually ship (OTLP), and are still scrubbed', () => {
  /**
   * Until the OTLP exporter existed, spans were created, named and scrubbed
   * but never left the process. The risk in adding a wire format is not that
   * traces fail to ship — it is that a SECOND export path becomes a second
   * place for patient data to escape.
   *
   * These tests capture the actual HTTP body the exporter would send.
   */
  function captureExport(): { bodies: unknown[]; restore: () => void } {
    const bodies: unknown[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((_url: string, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? '{}'));
      return Promise.resolve({ ok: true, status: 200 } as Response);
    }) as typeof fetch;
    return { bodies, restore: () => { globalThis.fetch = original; } };
  }

  it('scrubs patient identifiers on the OTLP path, not only the JSON one', async () => {
    const cap = captureExport();
    try {
      const tracer = new Tracer(new OtlpSpanExporter({ endpoint: 'http://collector:4318' }));

      const span = tracer.startSpan('imaging.upload', 'server', {
        'patient.name': 'Fatima Al-Mansouri',
        authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.abc.def',
        'patient.phone': '+218912345678',
      });
      tracer.endSpan(span);
      await Promise.resolve();

      const wire = JSON.stringify(cap.bodies);
      expect(wire).not.toContain('Fatima');
      expect(wire).not.toContain('Al-Mansouri');
      expect(wire).not.toContain('eyJhbGciOiJSUzI1NiJ9');
      expect(wire).not.toContain('912345678');
    } finally {
      cap.restore();
    }
  });

  it('sends one OTLP request per span, carrying the trace id', async () => {
    const cap = captureExport();
    try {
      const tracer = new Tracer(new OtlpSpanExporter({ endpoint: 'http://collector:4318' }));
      const root = tracer.startSpan('GET /studies', 'server', {});
      tracer.endSpan(root);
      await Promise.resolve();

      expect(cap.bodies).toHaveLength(1);
      const sent = cap.bodies[0] as {
        resourceSpans: { scopeSpans: { spans: { traceId: string; name: string }[] }[] }[];
      };
      const shipped = sent.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
      expect(shipped.traceId).toBe(root.traceId);
      expect(shipped.name).toBe('GET /studies');
    } finally {
      cap.restore();
    }
  });

  it('does not throw when the collector is unreachable', async () => {
    // Telemetry must never fail a request carrying patient imaging.
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch;
    try {
      const tracer = new Tracer(new OtlpSpanExporter({ endpoint: 'http://nope:4318' }));
      const span = tracer.startSpan('GET /studies', 'server', {});
      expect(() => tracer.endSpan(span)).not.toThrow();
      await Promise.resolve();
    } finally {
      globalThis.fetch = original;
    }
  });
});

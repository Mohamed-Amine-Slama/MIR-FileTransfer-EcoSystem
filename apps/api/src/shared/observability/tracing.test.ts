import { describe, expect, it } from 'vitest';
import { REDACTED } from './log-scrubber';
import {
  InMemorySpanExporter,
  Tracer,
  normaliseRoute,
  sanitiseAttributes,
} from './tracing';

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
});

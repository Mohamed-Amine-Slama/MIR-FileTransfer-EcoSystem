import { scrubForLog, scrubString } from './log-scrubber';

/**
 * Distributed tracing — BUILD_SPEC PHASE 13 item 1.
 *
 * "OpenTelemetry traces across API → DB → Orthanc → S3."
 *
 * WHY THIS IS A THIN WRAPPER RATHER THAN THE SDK:
 * the OpenTelemetry Node SDK is a large dependency tree, and installs on this
 * repository's filesystem have repeatedly failed part-way and corrupted the
 * workspace. More importantly, the part that must not be got wrong is not the
 * transport — it is that **span attributes go through the same scrubber as
 * logs**. A trace is shipped to the same third-party collector, read by the
 * same on-call engineers, and retained just as long. A patient name in a span
 * attribute has leaked exactly as thoroughly as one in a log line, and the
 * usual OTel instrumentation happily records full URLs and SQL statements.
 *
 * This module owns the naming and the redaction. Swapping in the real SDK is
 * then a change of `SpanExporter`, not a change of what gets recorded.
 */

export type SpanKind = 'server' | 'client' | 'internal' | 'producer' | 'consumer';

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export interface Span {
  name: string;
  kind: SpanKind;
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  startedAt: number;
  endedAt: number | undefined;
  attributes: SpanAttributes;
  status: 'unset' | 'ok' | 'error';
  error: string | undefined;
}

export interface SpanExporter {
  export(span: Span): void;
}

/**
 * Attributes that must never be recorded on a span, whatever their value.
 *
 * `db.statement` is the dangerous default: OTel's Postgres instrumentation
 * records the full SQL including bound parameters, which for this system means
 * patient ids, phone numbers, and consent text going to the collector.
 */
const FORBIDDEN_ATTRIBUTES = new Set([
  'db.statement',
  'db.sql.parameters',
  'http.request.body',
  'http.response.body',
  'url.query',
]);

/**
 * Attribute KEYS that name a patient identifier directly.
 *
 * The value-level scrubber cannot help here. A phone number or a token has a
 * detectable shape; a personal name does not — "Fatima Al-Mansouri" is
 * indistinguishable from any other string (the limitation documented in
 * docs/pre-launch-checklist.md).
 *
 * But when the KEY says `patient.name`, no detection is needed: the caller has
 * declared what the value is. Dropping on the key closes the case the value
 * scrubber structurally cannot.
 *
 * `patient.id` is deliberately NOT here: a UUID is the join key an
 * investigation needs (P4.4) and carries no personal information by itself.
 */
const IDENTIFYING_ATTRIBUTE_KEYS = [
  'patient.name',
  'patient.full_name',
  'patient.fullname',
  'patient.phone',
  'patient.dob',
  'patient.date_of_birth',
  'patient.national_id',
  'user.name',
  'user.full_name',
  'actor.name',
  'doctor.name',
];

/**
 * Strip identifiers out of a URL path so it can be a span name.
 *
 * `/patients/018f8e6a-.../claim-token` becomes `/patients/:id/claim-token`.
 * Recording the raw path would put a patient id into every span name, and span
 * names are the one field every tracing UI indexes and displays.
 */
export function normaliseRoute(path: string): string {
  return path
    .replace(/\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '/:id')
    // DICOM UIDs: dotted digit sequences.
    .replace(/\/\d+(?:\.\d+){3,}/g, '/:uid')
    .replace(/\/\d{4,}/g, '/:n');
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class Tracer {
  constructor(private readonly exporter: SpanExporter) {}

  startSpan(
    name: string,
    kind: SpanKind,
    attributes: SpanAttributes = {},
    parent?: { traceId: string; spanId: string },
  ): Span {
    return {
      name,
      kind,
      traceId: parent?.traceId ?? randomHex(16),
      spanId: randomHex(8),
      parentSpanId: parent?.spanId,
      startedAt: Date.now(),
      endedAt: undefined,
      attributes: sanitiseAttributes(attributes),
      status: 'unset',
      error: undefined,
    };
  }

  setAttributes(span: Span, attributes: SpanAttributes): void {
    Object.assign(span.attributes, sanitiseAttributes(attributes));
  }

  endSpan(span: Span, outcome: { error?: unknown } = {}): void {
    span.endedAt = Date.now();
    if (outcome.error !== undefined) {
      span.status = 'error';
      span.error = scrubString(
        outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
      );
    } else {
      span.status = 'ok';
    }
    this.exporter.export(span);
  }

  /** Convenience wrapper: time a call and record its outcome. */
  async inSpan<T>(
    name: string,
    kind: SpanKind,
    attributes: SpanAttributes,
    fn: () => Promise<T>,
    parent?: { traceId: string; spanId: string },
  ): Promise<T> {
    const span = this.startSpan(name, kind, attributes, parent);
    try {
      const result = await fn();
      this.endSpan(span);
      return result;
    } catch (err) {
      this.endSpan(span, { error: err });
      throw err;
    }
  }
}

/**
 * Drop forbidden attributes and scrub the rest.
 *
 * Applies the SAME scrubber as logs (PHASE 13). Traces are not a lesser
 * category of telemetry.
 */
export function sanitiseAttributes(attributes: SpanAttributes): SpanAttributes {
  const out: SpanAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (FORBIDDEN_ATTRIBUTES.has(lower)) continue;
    // The key declares the value is identifying, so no detection is required.
    if (IDENTIFYING_ATTRIBUTE_KEYS.includes(lower)) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = typeof value === 'string' ? (scrubForLog(value) as string) : value;
  }
  return out;
}

/** Exporter that writes scrubbed spans as structured JSON. */
export class ConsoleSpanExporter implements SpanExporter {
  export(span: Span): void {
    // eslint-disable-next-line no-console -- this IS the telemetry sink
    console.log(
      JSON.stringify({
        type: 'span',
        name: span.name,
        kind: span.kind,
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        durationMs: (span.endedAt ?? Date.now()) - span.startedAt,
        status: span.status,
        error: span.error,
        attributes: span.attributes,
      }),
    );
  }
}

/**
 * Ships spans to an OTLP/HTTP collector — BUILD_SPEC PHASE 13.
 *
 * Until this existed, spans were created, named and scrubbed but never left
 * the process: the exporter wrote JSON to stdout. "Traces across API -> DB ->
 * Orthanc -> S3" was unproven as a delivered pipeline.
 *
 * Deliberately hand-rolled against the OTLP/HTTP JSON protocol rather than
 * pulling in the full OpenTelemetry SDK. The Span type here is already the
 * shape this project needs, the scrubbing contract above is the property that
 * matters, and the SDK would add a second span pipeline whose sanitisation
 * path is not this one.
 *
 * FIRE AND FORGET, on purpose: telemetry must never delay or fail a request
 * carrying patient imaging. A collector that is down is a monitoring problem,
 * not a clinical one.
 */
export class OtlpSpanExporter implements SpanExporter {
  private readonly endpoint: string;
  private readonly serviceName: string;
  private failures = 0;

  constructor(options: { endpoint: string; serviceName?: string }) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.serviceName = options.serviceName ?? 'mir-api';
  }

  export(span: Span): void {
    // The span reaching here has ALREADY been scrubbed by the Tracer — this
    // class must not be a second place where raw attributes could escape, so
    // it serialises what it is given and adds nothing.
    const body = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: this.serviceName } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'mir' },
              spans: [
                {
                  traceId: span.traceId,
                  spanId: span.spanId,
                  ...(span.parentSpanId === undefined
                    ? {}
                    : { parentSpanId: span.parentSpanId }),
                  name: span.name,
                  kind: OTLP_KIND[span.kind] ?? 0,
                  startTimeUnixNano: `${span.startedAt * 1_000_000}`,
                  endTimeUnixNano: `${(span.endedAt ?? Date.now()) * 1_000_000}`,
                  attributes: Object.entries(span.attributes).map(([key, value]) => ({
                    key,
                    value:
                      typeof value === 'number'
                        ? { doubleValue: value }
                        : typeof value === 'boolean'
                          ? { boolValue: value }
                          : { stringValue: String(value) },
                  })),
                  status:
                    span.status === 'error'
                      ? { code: 2, ...(span.error === undefined ? {} : { message: span.error }) }
                      : { code: 1 },
                },
              ],
            },
          ],
        },
      ],
    };

    void fetch(`${this.endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {
      // Log once, then stay quiet: a collector outage must not turn every
      // request into a second error in the logs.
      this.failures += 1;
      if (this.failures === 1) {
        // eslint-disable-next-line no-console -- telemetry sink is unavailable
        console.warn(`[tracing] OTLP export failed; suppressing further warnings`);
      }
    });
  }
}

/** OTLP SpanKind enum values. */
const OTLP_KIND: Record<string, number> = {
  server: 2,
  client: 3,
  internal: 1,
  producer: 4,
  consumer: 5,
};

/** Collects spans in memory. For tests and local inspection. */
export class InMemorySpanExporter implements SpanExporter {
  readonly spans: Span[] = [];
  export(span: Span): void {
    this.spans.push(span);
  }
}

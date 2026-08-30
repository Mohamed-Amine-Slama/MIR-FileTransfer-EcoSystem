import {
  CallHandler,
  type ExecutionContext,
  Global,
  Injectable,
  Module,
  type NestInterceptor,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { getContext } from '../context/request-context';
import { normaliseRoute, OtlpSpanExporter, type SpanExporter, Tracer } from './tracing';

/**
 * P13 tracing, actually emitting spans.
 *
 * WHAT WAS WRONG. `Tracer` and `OtlpSpanExporter` were written and tested, and
 * referenced by nothing outside their own test. The checklist recorded "spans
 * ship to a real OTLP collector and arrive redacted (verified 2026-08-29)" —
 * true of the EXPORTER, which was pointed at a collector directly by that
 * test. The application produced no spans to ship. There was no interceptor,
 * no config key, and no endpoint in the compose file for the API service, even
 * though an `otel-collector` service sat there ready to receive.
 *
 * Third instance of the same defect in this codebase, after the log scrubber
 * and the rate limiter: a tested component nothing invoked, with a ledger note
 * that read as if it were in service.
 */

/** Drops spans. Used when no collector endpoint is configured. */
class NullSpanExporter implements SpanExporter {
  export(): void {
    /* deliberately nothing — see OTEL_EXPORTER_OTLP_ENDPOINT in config */
  }
}

@Injectable()
export class TracingInterceptor implements NestInterceptor {
  constructor(private readonly tracer: Tracer) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const ctx = getContext();

    // The route TEMPLATE, never the concrete path. `/patients/<uuid>` as a
    // span name would put a patient identifier in the trace backend's index,
    // where it is searchable by anyone with dashboard access — the exact leak
    // PHASE 13 exists to prevent, in the one place people forget to look.
    const route = normaliseRoute(request.originalUrl ?? request.url ?? '/');

    const span = this.tracer.startSpan(`${request.method} ${route}`, 'server', {
      'http.method': request.method,
      'http.route': route,
      // Attribute keys are filtered by `sanitiseAttributes`; the request id is
      // the safe correlation handle between a trace and a log line.
      'request.id': ctx?.requestId,
    });

    return next.handle().pipe(
      tap({
        next: () => {
          this.tracer.setAttributes(span, {
            'http.status_code': http.getResponse<Response>().statusCode,
          });
          this.tracer.endSpan(span);
        },
        error: (err: unknown) => {
          this.tracer.endSpan(span, { error: err });
        },
      }),
    );
  }
}

@Global()
@Module({
  providers: [
    {
      provide: Tracer,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const endpoint = config.OTEL_EXPORTER_OTLP_ENDPOINT;
        return new Tracer(
          endpoint === undefined
            ? new NullSpanExporter()
            : new OtlpSpanExporter({ endpoint, serviceName: 'mir-api' }),
        );
      },
    },
    { provide: APP_INTERCEPTOR, useClass: TracingInterceptor },
  ],
  exports: [Tracer],
})
export class TracingModule {}

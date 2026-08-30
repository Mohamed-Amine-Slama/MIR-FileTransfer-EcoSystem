import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PublicEndpoint } from '../authz/access-metadata';
import { GlobalExceptionFilter } from '../errors/global-exception.filter';
import { InMemorySpanExporter, Tracer } from './tracing';
import { TracingInterceptor } from './tracing.module';

/**
 * BUILD_SPEC P13 — spans must actually be EMITTED BY THE APPLICATION.
 *
 * `tracing.test.ts` proves the exporter: it points an `OtlpSpanExporter` at a
 * real collector and confirms redacted spans arrive. That was true while the
 * application emitted no spans at all — nothing constructed a `Tracer`, no
 * interceptor existed, and the compose file never gave the API an endpoint.
 *
 * These tests drive real HTTP requests and assert on what the tracer produced.
 */

@Controller()
class ProbeController {
  @PublicEndpoint()
  @Get('patients/:id')
  byId(): { ok: true } {
    return { ok: true };
  }

  @PublicEndpoint()
  @Get('boom')
  boom(): never {
    throw new Error('upstream exploded for +218912345678');
  }
}

const exporter = new InMemorySpanExporter();
let app: INestApplication;

beforeAll(async () => {
  @Module({
    controllers: [ProbeController],
    providers: [
      { provide: Tracer, useFactory: () => new Tracer(exporter) },
      { provide: APP_INTERCEPTOR, useClass: TracingInterceptor },
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('P13 the application emits spans', () => {
  it('produces a server span for a real request', async () => {
    const before = exporter.spans.length;
    await request(app.getHttpServer() as never)
      .get('/patients/6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d')
      .expect(200);

    const span = exporter.spans[exporter.spans.length - 1];
    expect(exporter.spans.length).toBe(before + 1);
    expect(span?.kind).toBe('server');
    expect(span?.status).toBe('ok');
    expect(span?.attributes['http.status_code']).toBe(200);
    expect(span?.endedAt).toBeDefined();
  }, 60_000);

  it('names the span by ROUTE TEMPLATE, never the concrete id', async () => {
    // A span named `GET /patients/<uuid>` puts a patient identifier into the
    // trace backend's search index, readable by anyone with dashboard access.
    // That is the PHASE 13 leak in the place people forget to look.
    const uuid = '6f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
    await request(app.getHttpServer() as never)
      .get(`/patients/${uuid}`)
      .expect(200);

    const span = exporter.spans[exporter.spans.length - 1];
    expect(span?.name).not.toContain(uuid);
    expect(span?.attributes['http.route']).not.toContain(uuid);
    expect(span?.name).toMatch(/^GET /);
  }, 60_000);

  it('records an error span with the message scrubbed', async () => {
    await request(app.getHttpServer() as never)
      .get('/boom')
      .expect(500);

    const span = exporter.spans[exporter.spans.length - 1];
    expect(span?.status).toBe('error');
    expect(span?.error).toBeDefined();
    // The phone in the thrown message must not survive into the trace.
    expect(span?.error).not.toContain('+218912345678');
    expect(span?.error).toContain('[redacted]');
  }, 60_000);

  it('app.module registers TracingModule, and compose points at the collector', () => {
    const mod = readFileSync(resolve(__dirname, '..', '..', 'app.module.ts'), 'utf8');
    expect(mod, 'TracingModule must be imported by AppModule').toContain('TracingModule');

    // The collector service existed all along with nothing sending to it.
    const compose = readFileSync(
      resolve(__dirname, '..', '..', '..', '..', '..', 'docker-compose.yml'),
      'utf8',
    );
    expect(compose, 'the API service needs an OTLP endpoint').toContain(
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    );
  });
});

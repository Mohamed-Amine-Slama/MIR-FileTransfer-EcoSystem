import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PublicEndpoint } from '../authz/access-metadata';
import { GlobalExceptionFilter } from '../errors/global-exception.filter';
import { SecurityHeadersMiddleware } from './security-headers.middleware';

/**
 * BUILD_SPEC P14.3 — the application half of edge protection.
 *
 * The Cloudflare WAF, edge rate limiting and bot protection need an account
 * and remain open. The header set does not, and until now the API sent NO
 * security headers at all — no helmet, nothing in main.ts.
 *
 * These assert the exact expected set, so a header silently dropped during a
 * refactor fails CI rather than shipping. The CSP is asserted by DIRECTIVE,
 * never by mere presence: a policy of `default-src *` would satisfy an
 * existence check while protecting nothing.
 */

const EXPECTED: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
};

@Controller()
class ProbeController {
  @PublicEndpoint()
  @Get('probe')
  ok(): { status: string } {
    return { status: 'ok' };
  }

  @PublicEndpoint()
  @Get('probe-throws')
  throws(): never {
    throw new Error('deliberate failure with a secret: patient Fatima Al-Mansouri');
  }
}

let app: INestApplication;

beforeAll(async () => {
  @Module({
    controllers: [ProbeController],
    providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(new SecurityHeadersMiddleware().use.bind(new SecurityHeadersMiddleware()));
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  await app.init();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('P14.3 API security headers', () => {
  it('sets every expected header on a successful response', async () => {
    const res = await request(app.getHttpServer() as never)
      .get('/probe')
      .expect(200);

    for (const [header, value] of Object.entries(EXPECTED)) {
      expect(res.headers[header], `missing or wrong: ${header}`).toBe(value);
    }
  });

  it('sets them on error responses too', async () => {
    // The error path is the one an attacker reaches. A filter that
    // short-circuits before headers are applied would pass the test above and
    // fail here.
    const res = await request(app.getHttpServer() as never)
      .get('/probe-throws')
      .expect(500);

    for (const [header, value] of Object.entries(EXPECTED)) {
      expect(res.headers[header], `missing or wrong on error: ${header}`).toBe(value);
    }
  });

  it('sets them on a 404 for a route that does not exist', async () => {
    const res = await request(app.getHttpServer() as never)
      .get('/no-such-route')
      .expect(404);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe(EXPECTED['content-security-policy']);
  });

  it('does not advertise the framework', async () => {
    const res = await request(app.getHttpServer() as never).get('/probe');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('the CSP permits nothing by default', async () => {
    const res = await request(app.getHttpServer() as never).get('/probe');
    const csp = res.headers['content-security-policy'] ?? '';

    // Asserted by directive: a wildcard policy would pass a presence check.
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('*');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('still does not leak internals in the error body (§6)', async () => {
    const res = await request(app.getHttpServer() as never)
      .get('/probe-throws')
      .expect(500);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('Fatima');
    expect(body).not.toContain('deliberate failure');
    expect(body).not.toContain('at ');
  });
});

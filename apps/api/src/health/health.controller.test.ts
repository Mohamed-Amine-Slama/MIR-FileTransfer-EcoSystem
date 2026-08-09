import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthModule } from './health.module';

describe('GET /health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with status ok (P1.1 gate)', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('exposes nothing beyond the status field', async () => {
    // A health endpoint is unauthenticated. Version strings, hostnames, and
    // dependency states handed out here are free reconnaissance.
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(Object.keys(res.body as object)).toEqual(['status']);
  });
});

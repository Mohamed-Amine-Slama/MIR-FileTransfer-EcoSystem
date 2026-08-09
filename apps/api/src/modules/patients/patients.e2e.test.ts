import { Module, type INestApplication, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@mir/contracts';
import { APP_CONFIG } from '../../shared/config/config.module';
import type { AppConfig } from '../../shared/config/config.schema';
import { DatabaseService } from '../../shared/db/database.service';
import { EventBus } from '../../shared/events/event-bus';
import { RequestContextMiddleware } from '../../shared/context/request-context.middleware';
import { setContext } from '../../shared/context/request-context';
import {
  appUrl,
  createUser,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { GlobalExceptionFilter } from '../../shared/errors/global-exception.filter';
import { PatientsController } from './internal/patients.controller';
import { PatientsService } from './internal/patients.service';

/**
 * BUILD_SPEC P5.1 — "the RLS tests from P3.2 still pass through the HTTP
 * layer, not just at the SQL layer", and P5.2 — the claim flow.
 *
 * These drive real HTTP against a real database. The point is that isolation
 * is proven along the path a request actually takes: middleware, guard,
 * controller, service, RLS. A service-level test would skip the two layers
 * most likely to lose the identity.
 *
 * Authentication is stubbed with a header-driven guard so the suite does not
 * need a Keycloak; token verification itself is covered in auth.test.ts.
 */

let h: Harness;
let db: DatabaseService;
let app: INestApplication;

/** Stand-in for AuthGuard: trusts two test headers instead of a JWT. */
class TestAuthGuard {
  canActivate(context: {
    switchToHttp: () => { getRequest: () => { headers: Record<string, string> } };
  }): boolean {
    const req = context.switchToHttp().getRequest();
    const userId = req.headers['x-test-user'];
    const role = req.headers['x-test-role'] as Role | undefined;
    if (userId === undefined || role === undefined) return false;

    setContext({
      userId,
      role,
      triageBeforePayment: false,
      ipAddress: '41.208.1.5',
      userAgent: 'vitest',
      requestId: 'e2e',
    });
    return true;
  }
}

const as = (server: unknown, userId: string, role: Role) => ({
  get: (url: string) =>
    request(server as never)
      .get(url)
      .set('x-test-user', userId)
      .set('x-test-role', role),
  post: (url: string) =>
    request(server as never)
      .post(url)
      .set('x-test-user', userId)
      .set('x-test-role', role),
});

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 3 } as AppConfig);

  @Module({
    controllers: [PatientsController],
    providers: [
      { provide: APP_CONFIG, useValue: { SCHEDULING_TRIAGE_BEFORE_PAYMENT: false } as AppConfig },
      { provide: DatabaseService, useValue: db },
      EventBus,
      PatientsService,
      Reflector,
      { provide: APP_GUARD, useClass: TestAuthGuard },
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ],
  })
  class TestModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(RequestContextMiddleware).forRoutes('*');
    }
  }

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  await truncateAll(h.owner);
});

const NEW_PATIENT = {
  phoneE164: '+218912345678',
  fullName: 'محمد علي',
  dateOfBirth: '1985-06-15',
  sex: 'M' as const,
};

describe('P5.1 patients over HTTP', () => {
  it('creates a patient and lists it back', async () => {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const server = app.getHttpServer();

    const created = await as(server, doctor, 'libya_doctor')
      .post('/patients')
      .send(NEW_PATIENT)
      .expect(200);

    expect(created.body.kind).toBe('created');

    const listed = await as(server, doctor, 'libya_doctor').get('/patients').expect(200);
    expect(listed.body.patients).toHaveLength(1);
    expect(listed.body.patients[0].fullName).toBe('محمد علي');
  });

  it('isolates two doctors end-to-end (the P5.1 gate)', async () => {
    const doctorA = await createUser(h.owner, 'libya_doctor');
    const doctorB = await createUser(h.owner, 'libya_doctor');
    const server = app.getHttpServer();

    const created = await as(server, doctorA, 'libya_doctor')
      .post('/patients')
      .send(NEW_PATIENT)
      .expect(200);
    const patientId = created.body.patientId as string;

    // B lists: sees nothing.
    const bList = await as(server, doctorB, 'libya_doctor').get('/patients').expect(200);
    expect(bList.body.patients).toHaveLength(0);

    // B fetches A's patient by id: 404, NOT 403. A 403 would confirm the
    // record exists (§6).
    await as(server, doctorB, 'libya_doctor').get(`/patients/${patientId}`).expect(404);

    // A can still see it — otherwise this passes against a broken-for-everyone policy.
    await as(server, doctorA, 'libya_doctor').get(`/patients/${patientId}`).expect(200);
  });

  it('does not leak existence through the search endpoint either', async () => {
    const doctorA = await createUser(h.owner, 'libya_doctor');
    const doctorB = await createUser(h.owner, 'libya_doctor');
    const server = app.getHttpServer();

    await as(server, doctorA, 'libya_doctor').post('/patients').send(NEW_PATIENT).expect(200);

    const search = await as(server, doctorB, 'libya_doctor')
      .get(`/patients/search?phone=${encodeURIComponent(NEW_PATIENT.phoneE164)}`)
      .expect(200);

    // Doctor B searching A's patient's phone gets nothing back — so the search
    // endpoint cannot be used to enumerate other doctors' patients.
    expect(search.body.candidates).toHaveLength(0);
  });

  describe('P3.3 identity matching over HTTP', () => {
    it('returns confirmation_required on a phone match instead of merging', async () => {
      const doctor = await createUser(h.owner, 'libya_doctor');
      const server = app.getHttpServer();

      await as(server, doctor, 'libya_doctor').post('/patients').send(NEW_PATIENT).expect(200);

      const second = await as(server, doctor, 'libya_doctor')
        .post('/patients')
        .send({ ...NEW_PATIENT, fullName: 'Mohamed Ali', dateOfBirth: '1985-06-15' })
        .expect(200);

      expect(second.body.kind).toBe('confirmation_required');
      expect(second.body.candidates).toHaveLength(1);
      // The doctor is shown name + DOB to decide with.
      expect(second.body.candidates[0].fullName).toBe('محمد علي');
      expect(second.body.candidates[0].dateOfBirth).toBe('1985-06-15');

      // Only one record so far — nothing was silently created or merged.
      const list = await as(server, doctor, 'libya_doctor').get('/patients').expect(200);
      expect(list.body.patients).toHaveLength(1);
    });

    it('creates a SECOND record once the doctor confirms they are different people', async () => {
      const doctor = await createUser(h.owner, 'libya_doctor');
      const server = app.getHttpServer();

      const first = await as(server, doctor, 'libya_doctor')
        .post('/patients')
        .send(NEW_PATIENT)
        .expect(200);

      // A family sharing one handset. Two records is the correct outcome.
      const second = await as(server, doctor, 'libya_doctor')
        .post('/patients')
        .send({
          ...NEW_PATIENT,
          fullName: 'فاطمة علي',
          dateOfBirth: '2010-02-02',
          sex: 'F',
          confirmedDistinctFrom: [first.body.patientId],
        })
        .expect(200);

      expect(second.body.kind).toBe('created');
      expect(second.body.patientId).not.toBe(first.body.patientId);

      const list = await as(server, doctor, 'libya_doctor').get('/patients').expect(200);
      expect(list.body.patients).toHaveLength(2);
    });

    it('rejects a phone number that is not E.164 rather than guessing', async () => {
      const doctor = await createUser(h.owner, 'libya_doctor');
      const res = await as(app.getHttpServer(), doctor, 'libya_doctor')
        .post('/patients')
        .send({ ...NEW_PATIENT, phoneE164: '0912345678' })
        .expect(400);

      // A bare national number is never assumed to be Libyan: guessing "+218"
      // would match a Tunisian patient sharing the trailing digits.
      expect(res.body.message).toMatch(/E\.164/);
    });
  });
});

describe('P5.2 patient claim flow', () => {
  async function seedPatientAndUser() {
    const doctor = await createUser(h.owner, 'libya_doctor');
    const server = app.getHttpServer();
    const created = await as(server, doctor, 'libya_doctor')
      .post('/patients')
      .send(NEW_PATIENT)
      .expect(200);
    const patientId = created.body.patientId as string;

    // The patient account, registered against the same phone number.
    const patientUser = await h.owner.query<{ id: string }>(
      `INSERT INTO identity_users (keycloak_sub, role, phone_e164, full_name, status)
       VALUES ($1, 'patient', $2, 'Patient Account', 'active') RETURNING id`,
      [`sub-claim-${Date.now()}`, NEW_PATIENT.phoneE164],
    );
    return { doctor, patientId, patientUser: patientUser.rows[0]?.id as string, server };
  }

  /** Read the plaintext token from the service (the API only SMSs it). */
  async function issueToken(doctor: string, patientId: string): Promise<string> {
    const svc = app.get(PatientsService);
    const { runWithContext } = await import('../../shared/context/request-context');
    return runWithContext(
      {
        userId: doctor,
        role: 'libya_doctor',
        triageBeforePayment: false,
        ipAddress: '41.208.1.5',
        userAgent: 'vitest',
        requestId: 'e2e',
      },
      async () => (await svc.issueClaimToken(patientId)).token,
    );
  }

  it('claims the record with a valid code and links the account', async () => {
    const { doctor, patientId, patientUser, server } = await seedPatientAndUser();
    const token = await issueToken(doctor, patientId);

    const res = await as(server, patientUser, 'patient')
      .post('/patients/claim')
      .send({ token })
      .expect(200);

    expect(res.body.patientId).toBe(patientId);

    // The patient can now see their own record — and could not before.
    const mine = await as(server, patientUser, 'patient').get(`/patients/${patientId}`).expect(200);
    expect(mine.body.id).toBe(patientId);
  });

  it('rejects a reused token (single use)', async () => {
    const { doctor, patientId, patientUser, server } = await seedPatientAndUser();
    const token = await issueToken(doctor, patientId);

    await as(server, patientUser, 'patient').post('/patients/claim').send({ token }).expect(200);
    await as(server, patientUser, 'patient').post('/patients/claim').send({ token }).expect(404);
  });

  it('rejects an expired token', async () => {
    const { doctor, patientId, patientUser, server } = await seedPatientAndUser();
    const token = await issueToken(doctor, patientId);

    await h.owner.query(
      `UPDATE patients_claim_tokens SET expires_at = now() - interval '1 minute'
       WHERE patient_id = $1`,
      [patientId],
    );

    await as(server, patientUser, 'patient').post('/patients/claim').send({ token }).expect(404);
  });

  it('rejects an unknown token', async () => {
    const { patientUser, server } = await seedPatientAndUser();
    await as(server, patientUser, 'patient')
      .post('/patients/claim')
      .send({ token: '000000' })
      .expect(404);
  });

  it('claiming grants access to that record and NO other', async () => {
    const { doctor, patientId, patientUser, server } = await seedPatientAndUser();

    // A second, unrelated patient belonging to the same doctor.
    const other = await as(server, doctor, 'libya_doctor')
      .post('/patients')
      .send({ ...NEW_PATIENT, phoneE164: '+218999888777', fullName: 'Someone Else' })
      .expect(200);

    const token = await issueToken(doctor, patientId);
    await as(server, patientUser, 'patient').post('/patients/claim').send({ token }).expect(200);

    const list = await as(server, patientUser, 'patient').get('/patients').expect(200);
    expect(list.body.patients).toHaveLength(1);
    expect(list.body.patients[0].id).toBe(patientId);

    await as(server, patientUser, 'patient')
      .get(`/patients/${other.body.patientId}`)
      .expect(404);
  });

  it("a token issued to one phone cannot be redeemed by a different person's account", async () => {
    const { doctor, patientId, server } = await seedPatientAndUser();
    const token = await issueToken(doctor, patientId);

    // An attacker with a valid code but a different registered number.
    const attacker = await createUser(h.owner, 'patient');

    await as(server, attacker, 'patient').post('/patients/claim').send({ token }).expect(404);

    // And the record stays unclaimed.
    const row = await h.owner.query<{ claimed_by_user: string | null }>(
      'SELECT claimed_by_user FROM patients_patients WHERE id = $1',
      [patientId],
    );
    expect(row.rows[0]?.claimed_by_user).toBeNull();
  });

  it('rejects a malformed token as 400, without echoing the value', async () => {
    const { patientUser, server } = await seedPatientAndUser();
    const res = await as(server, patientUser, 'patient')
      .post('/patients/claim')
      .send({ token: 'not-a-real-token-value' })
      .expect(400);

    // The response describes the failing field, never the submitted value —
    // echoed input is how a credential ends up in a proxy log (§6).
    expect(JSON.stringify(res.body)).not.toContain('not-a-real-token-value');
    expect(res.body.details[0].path).toBe('token');
  });

  it('does not leak stack traces or SQL on an unexpected error', async () => {
    const { patientUser, server } = await seedPatientAndUser();
    const res = await as(server, patientUser, 'patient')
      .get('/patients/not-a-uuid')
      .expect(400);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/at \w+ \(/); // no stack frames
    expect(body).not.toMatch(/SELECT|INSERT|patients_patients/i); // no SQL
  });

  it('a doctor cannot issue a claim token for another doctor patient', async () => {
    const { patientId } = await seedPatientAndUser();
    const otherDoctor = await createUser(h.owner, 'libya_doctor');

    await as(app.getHttpServer(), otherDoctor, 'libya_doctor')
      .post(`/patients/${patientId}/claim-token`)
      .expect(404);
  });
});

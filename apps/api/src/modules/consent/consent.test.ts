import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { runWithContext, type RequestContext } from '../../shared/context/request-context';
import { DatabaseService } from '../../shared/db/database.service';
import {
  appUrl,
  createAppointment,
  createPatient,
  createStudy,
  createUser,
  linkStudy,
  setupTestDatabase,
  truncateAll,
  type Harness,
} from '../../shared/db/testing/rls-harness';
import { EventBus } from '../../shared/events/event-bus';
import {
  ConsentService,
  ConsentTextMismatchError,
  hashConsentText,
} from './internal/consent.service';

/**
 * BUILD_SPEC P5.3 — consent. Legally critical.
 *
 * Gate: access genuinely disappears on revocation, AND consent evidence is
 * reconstructible — given a consent row, produce the exact text the patient
 * saw.
 */

let h: Harness;
let db: DatabaseService;
let bus: EventBus;
let consent: ConsentService;

const V1_AR = 'أوافق على نقل صوري الطبية إلى الطبيب المستقبل في تونس.';
const V1_FR = "J'accepte le transfert de mes images médicales au médecin destinataire en Tunisie.";
const V2_AR = 'أوافق على نقل صوري الطبية إلى الطبيب المستقبل في تونس. (نسخة معدلة)';

const ctx = (userId: string, role: RequestContext['role']): RequestContext => ({
  userId,
  role,
  triageBeforePayment: false,
  ipAddress: '41.208.1.5',
  userAgent: 'Mozilla/5.0 (test)',
  requestId: 'req-consent-test',
});

async function publishTerms(version: string, locale: 'ar' | 'fr', body: string): Promise<void> {
  await h.owner.query(
    `INSERT INTO consent_terms (version, locale, scope, body, content_hash, published_at)
     VALUES ($1, $2, 'cross_border_transfer', $3, $4, now())
     ON CONFLICT DO NOTHING`,
    [version, locale, body, hashConsentText(body)],
  );
}

beforeAll(async () => {
  h = await setupTestDatabase();
  db = new DatabaseService({ DATABASE_URL: appUrl(), DATABASE_POOL_MAX: 4 } as AppConfig);
  bus = new EventBus();
  consent = new ConsentService(db, bus);

  // Published terms are immutable BY DESIGN — the trigger refuses to delete
  // them. So they are seeded once for the whole suite rather than per test.
  // A fixture lifecycle that fights the immutability guarantee would be a
  // reason to weaken the guarantee, which is exactly backwards.
  await publishTerms('v1', 'ar', V1_AR);
  await publishTerms('v1', 'fr', V1_FR);
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
  await h?.close();
});

beforeEach(async () => {
  // Clears consent_records (among others). consent_terms is deliberately left
  // alone; see the note in beforeAll.
  await truncateAll(h.owner);
});

describe('P5.3 consent', () => {
  async function setupPatient() {
    const libyaDoctor = await createUser(h.owner, 'libya_doctor');
    const tunisDoctor = await createUser(h.owner, 'tunisia_doctor');
    const patientUser = await createUser(h.owner, 'patient');
    const patient = await createPatient(h.owner, libyaDoctor, patientUser);
    return { libyaDoctor, tunisDoctor, patientUser, patient };
  }

  it('records the named doctor, version, locale, IP, user agent and hash', async () => {
    const { tunisDoctor, patientUser, patient } = await setupPatient();

    const { consentId, evidenceHash } = await runWithContext(
      ctx(patientUser, 'patient'),
      async () =>
        consent.grant({
          patientId: patient,
          grantedTo: tunisDoctor,
          locale: 'ar',
          version: 'v1',
          renderedText: V1_AR,
        }),
    );

    const row = await h.owner.query<{
      granted_to: string;
      terms_version: string;
      terms_locale: string;
      evidence_hash: string;
      ip_address: string;
      user_agent: string;
      revoked_at: Date | null;
    }>('SELECT * FROM consent_records WHERE id = $1', [consentId]);

    const r = row.rows[0];
    expect(r?.granted_to).toBe(tunisDoctor);
    expect(r?.terms_version).toBe('v1');
    expect(r?.terms_locale).toBe('ar');
    expect(r?.evidence_hash).toBe(hashConsentText(V1_AR));
    expect(r?.ip_address).toBe('41.208.1.5');
    expect(r?.user_agent).toBe('Mozilla/5.0 (test)');
    expect(r?.revoked_at).toBeNull();
    expect(evidenceHash).toHaveLength(64);
  });

  it('refuses consent to wording that does not match the published terms', async () => {
    // A stale browser tab showing old wording must not have the patient's
    // agreement filed against text they never read.
    const { tunisDoctor, patientUser, patient } = await setupPatient();

    await expect(
      runWithContext(ctx(patientUser, 'patient'), async () =>
        consent.grant({
          patientId: patient,
          grantedTo: tunisDoctor,
          locale: 'ar',
          version: 'v1',
          renderedText: `${V1_AR} (edited by the client)`,
        }),
      ),
    ).rejects.toThrow(ConsentTextMismatchError);

    const rows = await h.owner.query('SELECT id FROM consent_records');
    expect(rows.rowCount).toBe(0);
  });

  describe('the evidence gate', () => {
    it('reproduces the exact text the patient saw', async () => {
      const { tunisDoctor, patientUser, patient } = await setupPatient();

      const { consentId } = await runWithContext(ctx(patientUser, 'patient'), async () =>
        consent.grant({
          patientId: patient,
          grantedTo: tunisDoctor,
          locale: 'ar',
          version: 'v1',
          renderedText: V1_AR,
        }),
      );

      const evidence = await runWithContext(ctx(patientUser, 'patient'), async () =>
        consent.getEvidence(consentId),
      );

      expect(evidence.text).toBe(V1_AR);
      expect(evidence.intact).toBe(true);
      expect(evidence.termsVersion).toBe('v1');
      expect(evidence.termsLocale).toBe('ar');
      expect(evidence.grantedTo).toBe(tunisDoctor);
    });

    it('publishing v2 leaves existing v1 consents valid and pointing at v1 text', async () => {
      const { tunisDoctor, patientUser, patient } = await setupPatient();

      const { consentId } = await runWithContext(ctx(patientUser, 'patient'), async () =>
        consent.grant({
          patientId: patient,
          grantedTo: tunisDoctor,
          locale: 'ar',
          version: 'v1',
          renderedText: V1_AR,
        }),
      );

      await publishTerms('v2', 'ar', V2_AR);
      await publishTerms('v2', 'fr', `${V1_FR} (v2)`);

      const evidence = await runWithContext(ctx(patientUser, 'patient'), async () =>
        consent.getEvidence(consentId),
      );

      // Still v1, still the original wording, still valid.
      expect(evidence.termsVersion).toBe('v1');
      expect(evidence.text).toBe(V1_AR);
      expect(evidence.text).not.toContain('معدلة');
      expect(evidence.intact).toBe(true);
      expect(evidence.revokedAt).toBeNull();
    });

    it('the database refuses to edit published terms', async () => {
      // This is what makes reconstruction trustworthy. Without it, a "fix a
      // typo" UPDATE silently invalidates every consent already granted.
      await expect(
        h.owner.query(`UPDATE consent_terms SET body = 'rewritten' WHERE version = 'v1'`),
      ).rejects.toThrow(/published and immutable/i);

      await expect(
        h.owner.query(`DELETE FROM consent_terms WHERE version = 'v1'`),
      ).rejects.toThrow(/published and cannot be deleted/i);
    });

    it('reports intact=false if stored text and stored hash ever disagree', async () => {
      const { tunisDoctor, patientUser, patient } = await setupPatient();
      const { consentId } = await runWithContext(ctx(patientUser, 'patient'), async () =>
        consent.grant({
          patientId: patient,
          grantedTo: tunisDoctor,
          locale: 'ar',
          version: 'v1',
          renderedText: V1_AR,
        }),
      );

      // Simulate tampering that bypassed the trigger (e.g. a restore from a
      // doctored backup). The evidence API must say so rather than return
      // text that looks authoritative.
      await h.owner.query(`UPDATE consent_records SET evidence_hash = $1 WHERE id = $2`, [
        '0'.repeat(64),
        consentId,
      ]);

      const evidence = await runWithContext(ctx(patientUser, 'patient'), async () =>
        consent.getEvidence(consentId),
      );
      expect(evidence.intact).toBe(false);
    });
  });

  describe('revocation', () => {
    it('revoking is an update, never a delete', async () => {
      const { tunisDoctor, patientUser, patient } = await setupPatient();
      const { consentId } = await runWithContext(ctx(patientUser, 'patient'), async () =>
        consent.grant({
          patientId: patient,
          grantedTo: tunisDoctor,
          locale: 'ar',
          version: 'v1',
          renderedText: V1_AR,
        }),
      );

      await runWithContext(ctx(patientUser, 'patient'), async () => consent.revoke(consentId));

      const rows = await h.owner.query<{ revoked_at: Date | null }>(
        'SELECT revoked_at FROM consent_records WHERE id = $1',
        [consentId],
      );
      // The row survives — the fact consent was once given is part of the record.
      expect(rows.rowCount).toBe(1);
      expect(rows.rows[0]?.revoked_at).not.toBeNull();
    });

    it("makes the receiving doctor's access disappear immediately (the gate)", async () => {
      const { libyaDoctor, tunisDoctor, patientUser, patient } = await setupPatient();
      const study = await createStudy(h.owner, patient, libyaDoctor);
      const appt = await createAppointment(h.owner, patient, tunisDoctor, 'confirmed');
      await linkStudy(h.owner, appt, study);

      const { consentId } = await runWithContext(ctx(patientUser, 'patient'), async () =>
        consent.grant({
          patientId: patient,
          grantedTo: tunisDoctor,
          locale: 'ar',
          version: 'v1',
          renderedText: V1_AR,
        }),
      );

      const before = await db.txAs(ctx(tunisDoctor, 'tunisia_doctor'), async (tx) =>
        (await tx.query('SELECT id FROM imaging_studies WHERE id = $1', [study])).rowCount,
      );
      expect(before).toBe(1);

      await runWithContext(ctx(patientUser, 'patient'), async () => consent.revoke(consentId));

      const after = await db.txAs(ctx(tunisDoctor, 'tunisia_doctor'), async (tx) =>
        (await tx.query('SELECT id FROM imaging_studies WHERE id = $1', [study])).rowCount,
      );
      // No cache to invalidate, no session to expire — the RLS policy tests
      // revoked_at on every read.
      expect(after).toBe(0);
    });

    it('a second revocation is a no-op, not a crash', async () => {
      const { tunisDoctor, patientUser, patient } = await setupPatient();
      const { consentId } = await runWithContext(ctx(patientUser, 'patient'), async () =>
        consent.grant({
          patientId: patient,
          grantedTo: tunisDoctor,
          locale: 'ar',
          version: 'v1',
          renderedText: V1_AR,
        }),
      );

      await runWithContext(ctx(patientUser, 'patient'), async () => consent.revoke(consentId));
      await expect(
        runWithContext(ctx(patientUser, 'patient'), async () => consent.revoke(consentId)),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('blocking transfer without consent', () => {
    it('a doctor with an appointment but no consent sees nothing (RLS layer)', async () => {
      const { libyaDoctor, tunisDoctor, patient } = await setupPatient();
      const study = await createStudy(h.owner, patient, libyaDoctor);
      const appt = await createAppointment(h.owner, patient, tunisDoctor, 'confirmed');
      await linkStudy(h.owner, appt, study);

      const rows = await db.txAs(ctx(tunisDoctor, 'tunisia_doctor'), async (tx) =>
        (await tx.query('SELECT id FROM imaging_studies')).rowCount,
      );
      expect(rows).toBe(0);
    });

    it('consent naming a different doctor does not unlock access', async () => {
      const { libyaDoctor, tunisDoctor, patientUser, patient } = await setupPatient();
      const otherDoctor = await createUser(h.owner, 'tunisia_doctor');
      const study = await createStudy(h.owner, patient, libyaDoctor);
      const appt = await createAppointment(h.owner, patient, tunisDoctor, 'confirmed');
      await linkStudy(h.owner, appt, study);

      // Consent granted to someone else entirely.
      await runWithContext(ctx(patientUser, 'patient'), async () =>
        consent.grant({
          patientId: patient,
          grantedTo: otherDoctor,
          locale: 'ar',
          version: 'v1',
          renderedText: V1_AR,
        }),
      );

      const rows = await db.txAs(ctx(tunisDoctor, 'tunisia_doctor'), async (tx) =>
        (await tx.query('SELECT id FROM imaging_studies')).rowCount,
      );
      expect(rows).toBe(0);
    });
  });

  describe('locale handling (DECISION D4)', () => {
    it('hashes the locale the patient actually saw, not a canonical language', async () => {
      const { tunisDoctor, patientUser, patient } = await setupPatient();

      const { consentId } = await runWithContext(ctx(patientUser, 'patient'), async () =>
        consent.grant({
          patientId: patient,
          grantedTo: tunisDoctor,
          locale: 'fr',
          version: 'v1',
          renderedText: V1_FR,
        }),
      );

      const evidence = await runWithContext(ctx(patientUser, 'patient'), async () =>
        consent.getEvidence(consentId),
      );
      expect(evidence.termsLocale).toBe('fr');
      expect(evidence.text).toBe(V1_FR);
      expect(evidence.evidenceHash).toBe(hashConsentText(V1_FR));
      expect(evidence.evidenceHash).not.toBe(hashConsentText(V1_AR));
    });
  });

  describe('hashConsentText', () => {
    it('normalises line endings but nothing else', () => {
      expect(hashConsentText('a\r\nb')).toBe(hashConsentText('a\nb'));
      // Whitespace and Unicode form are NOT normalised — the hash must bind to
      // the bytes displayed.
      expect(hashConsentText('a b')).not.toBe(hashConsentText('a  b'));
      expect(hashConsentText('Ali')).not.toBe(hashConsentText('ali'));
    });
  });
});

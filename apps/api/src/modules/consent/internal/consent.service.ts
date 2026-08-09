import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Locale } from '@mir/contracts';
import { DatabaseService, type Tx } from '../../../shared/db/database.service';
import { requireContext } from '../../../shared/context/request-context';
import { EventBus } from '../../../shared/events/event-bus';

/**
 * Consent capture — BUILD_SPEC P5.3. Legally critical.
 *
 * THE PROPERTY THIS MODULE EXISTS TO PROVIDE:
 * given a consent row, reproduce the exact text the patient saw, and prove it
 * has not changed since. Everything else here follows from that.
 *
 * Consent is never a boolean and never a deletion (§17):
 *   * granting writes an immutable hash of the rendered wording;
 *   * revoking sets `revoked_at` — the row stays, because the fact that
 *     consent was once given is itself part of the record;
 *   * the wording lives in `consent_terms`, which the database refuses to
 *     modify once published.
 *
 * BLOCKING L4: whether Libyan or Tunisian law requires written, witnessed, or
 * language-specific consent is unresolved. The shape here — versioned content,
 * per-locale, hashed at the point of display — supports any of those answers
 * without a schema change.
 */

export interface ConsentTerms {
  version: string;
  locale: Locale;
  scope: string;
  body: string;
  contentHash: string;
  publishedAt: Date | null;
}

export interface GrantConsentInput {
  patientId: string;
  /** The NAMED receiving doctor. Consent is never open-ended. */
  grantedTo: string;
  scope?: string;
  locale: Locale;
  version: string;
  /**
   * The exact text rendered in the patient's browser. Hashed and compared
   * against the published terms — see grant().
   */
  renderedText: string;
}

export interface ConsentEvidence {
  consentId: string;
  patientId: string;
  grantedTo: string;
  grantedAt: Date;
  revokedAt: Date | null;
  termsVersion: string;
  termsLocale: string;
  /** The exact wording the patient agreed to. */
  text: string;
  evidenceHash: string;
  /** False if the stored hash no longer matches the stored text. */
  intact: boolean;
  ipAddress: string | null;
  userAgent: string | null;
}

export class ConsentTextMismatchError extends Error {
  constructor() {
    super(
      'The consent text submitted does not match the published terms for that ' +
        'version and locale. Refusing to record consent to unknown wording.',
    );
    this.name = 'ConsentTextMismatchError';
  }
}

export function hashConsentText(text: string): string {
  // Normalise line endings only. Nothing else — not whitespace, not Unicode
  // form. The hash must bind to the bytes that were displayed, and "helpful"
  // normalisation is exactly how a hash stops matching the thing it attests.
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

@Injectable()
export class ConsentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly bus: EventBus,
  ) {}

  /** Fetch the published terms a patient should be shown. */
  async getPublishedTerms(version: string, locale: Locale, scope = 'cross_border_transfer'): Promise<ConsentTerms> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        version: string;
        locale: Locale;
        scope: string;
        body: string;
        content_hash: string;
        published_at: Date | null;
      }>(
        `SELECT version, locale, scope, body, content_hash, published_at
         FROM consent_terms
         WHERE version = $1 AND locale = $2 AND scope = $3 AND published_at IS NOT NULL`,
        [version, locale, scope],
      );

      const row = res.rows[0];
      if (row === undefined) {
        throw new NotFoundException('Consent terms not found');
      }
      return {
        version: row.version,
        locale: row.locale,
        scope: row.scope,
        body: row.body,
        contentHash: row.content_hash,
        publishedAt: row.published_at,
      };
    });
  }

  /**
   * Record consent.
   *
   * The client sends back the text it displayed. We hash it and compare
   * against the published wording before storing anything. If a stale browser
   * tab showed v1 while v2 is now current, this rejects rather than silently
   * filing the patient's agreement under wording they never read.
   */
  async grant(input: GrantConsentInput): Promise<{ consentId: string; evidenceHash: string }> {
    const ctx = requireContext();
    const scope = input.scope ?? 'cross_border_transfer';
    const submittedHash = hashConsentText(input.renderedText);

    const result = await this.db.tx(async (tx: Tx) => {
      const terms = await tx.query<{ content_hash: string }>(
        `SELECT content_hash FROM consent_terms
         WHERE version = $1 AND locale = $2 AND scope = $3 AND published_at IS NOT NULL`,
        [input.version, input.locale, scope],
      );

      const published = terms.rows[0];
      if (published === undefined) {
        throw new NotFoundException('Consent terms not found');
      }
      if (published.content_hash !== submittedHash) {
        throw new ConsentTextMismatchError();
      }

      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO consent_records
           (patient_id, scope, granted_to, terms_version, terms_locale, terms_scope,
            evidence_hash, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $2, $6, $7, $8)
         RETURNING id`,
        [
          input.patientId,
          scope,
          input.grantedTo,
          input.version,
          input.locale,
          submittedHash,
          ctx.ipAddress ?? null,
          ctx.userAgent ?? null,
        ],
      );

      const row = inserted.rows[0];
      if (row === undefined) {
        // RLS filtered the insert: this patient is not one the caller has
        // claimed. Surface as not-found rather than forbidden (§6).
        throw new NotFoundException('Patient not found');
      }
      return { consentId: row.id, evidenceHash: submittedHash };
    });

    await this.bus.publish({
      type: 'ConsentGranted',
      consentId: result.consentId,
      patientId: input.patientId,
      grantedTo: input.grantedTo,
      termsVersion: input.version,
      termsLocale: input.locale,
      actorId: ctx.userId,
      actorRole: ctx.role,
      occurredAt: new Date(),
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return result;
  }

  /**
   * Revoke consent.
   *
   * An UPDATE, never a DELETE. Access disappears immediately because the RLS
   * policies test `revoked_at IS NULL` on every read — there is no cache to
   * invalidate and no session to expire.
   */
  async revoke(consentId: string): Promise<void> {
    const ctx = requireContext();

    const revoked = await this.db.tx(async (tx) => {
      const res = await tx.query<{ id: string; patient_id: string; granted_to: string }>(
        `UPDATE consent_records
         SET revoked_at = now()
         WHERE id = $1 AND revoked_at IS NULL
         RETURNING id, patient_id, granted_to`,
        [consentId],
      );
      return res.rows[0];
    });

    if (revoked === undefined) {
      throw new NotFoundException('Consent not found');
    }

    await this.bus.publish({
      type: 'ConsentRevoked',
      consentId: revoked.id,
      patientId: revoked.patient_id,
      grantedTo: revoked.granted_to,
      actorId: ctx.userId,
      actorRole: ctx.role,
      occurredAt: new Date(),
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /**
   * Reconstruct what the patient actually saw — the P5.3 gate.
   *
   * `intact` re-derives the hash from the stored wording and compares it to
   * the hash captured at signing time. If they ever disagree, the evidence
   * cannot be relied upon, and saying so plainly is more useful than returning
   * text that looks authoritative.
   */
  async getEvidence(consentId: string): Promise<ConsentEvidence> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        patient_id: string;
        granted_to: string;
        granted_at: Date;
        revoked_at: Date | null;
        terms_version: string;
        terms_locale: string;
        evidence_hash: string;
        ip_address: string | null;
        user_agent: string | null;
        body: string;
      }>(
        `SELECT c.id, c.patient_id, c.granted_to, c.granted_at, c.revoked_at,
                c.terms_version, c.terms_locale, c.evidence_hash,
                c.ip_address::text AS ip_address, c.user_agent,
                t.body
         FROM consent_records c
         JOIN consent_terms t
           ON t.version = c.terms_version
          AND t.locale  = c.terms_locale
          AND t.scope   = c.terms_scope
         WHERE c.id = $1`,
        [consentId],
      );

      const row = res.rows[0];
      if (row === undefined) throw new NotFoundException('Consent not found');

      return {
        consentId: row.id,
        patientId: row.patient_id,
        grantedTo: row.granted_to,
        grantedAt: row.granted_at,
        revokedAt: row.revoked_at,
        termsVersion: row.terms_version,
        termsLocale: row.terms_locale,
        text: row.body,
        evidenceHash: row.evidence_hash,
        intact: hashConsentText(row.body) === row.evidence_hash,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
      };
    });
  }
}

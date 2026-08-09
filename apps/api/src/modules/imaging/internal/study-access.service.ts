import { Injectable, NotFoundException } from '@nestjs/common';
import { requireContext } from '../../../shared/context/request-context';
import { DatabaseService } from '../../../shared/db/database.service';
import { EventBus } from '../../../shared/events/event-bus';
import { SignedUrlService } from '../../../shared/storage/signed-url.service';

/**
 * Authorization and audit for study access — BUILD_SPEC P8.2.
 *
 * Every DICOMweb request passes through here, and every one of them produces a
 * `StudyAccessed` audit event — INCLUDING the ones that are refused.
 *
 * WHY DENIED ATTEMPTS ARE AUDITED:
 * a compromised doctor account looks, at first, exactly like a doctor clicking
 * around studies they cannot see. If only successful reads are recorded, the
 * reconnaissance phase of a breach leaves no trace at all, and the incident
 * timeline starts at the first thing that worked. P4.5's anomaly sweep reads
 * these rows.
 *
 * WHY THE ANSWER IS 404 AND NOT 403:
 * a 403 confirms the study exists. Combined with time-ordered UUIDv7 ids, that
 * turns the endpoint into an enumeration oracle for how many studies a given
 * patient has (§6).
 */

export type AccessKind = 'metadata' | 'pixel_data' | 'thumbnail';

export interface AuthorisedStudy {
  studyId: string;
  studyInstanceUid: string;
  patientId: string;
}

@Injectable()
export class StudyAccessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly bus: EventBus,
    private readonly signedUrls: SignedUrlService,
  ) {}

  /**
   * Resolve a study the caller is allowed to see, or throw 404.
   *
   * Authorization is NOT re-implemented here. The query runs under row-level
   * security, so the row simply is not visible unless the policies allow it —
   * consent, appointment linkage and the D3 payment gate all included. A
   * TypeScript-side permission check would be a second, weaker copy of that
   * logic which could drift (ADR-6).
   */
  async authoriseStudyAccess(
    studyInstanceUid: string,
    kind: AccessKind,
  ): Promise<AuthorisedStudy> {
    const ctx = requireContext();

    const found = await this.db.tx(async (tx) => {
      const res = await tx.query<{ id: string; patient_id: string; study_instance_uid: string }>(
        `SELECT id, patient_id, study_instance_uid
         FROM imaging_studies
         WHERE study_instance_uid = $1 AND status IN ('ready', 'processing')`,
        [studyInstanceUid],
      );
      return res.rows[0];
    });

    if (found === undefined) {
      // Audit the refusal before throwing. `patientId` is unknown precisely
      // because the row was invisible — recording the attempt is still the
      // point.
      await this.bus.publish({
        type: 'StudyAccessed',
        studyId: undefined,
        studyInstanceUid,
        patientId: undefined,
        accessKind: kind,
        granted: false,
        actorId: ctx.userId,
        actorRole: ctx.role,
        occurredAt: new Date(),
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new NotFoundException('Study not found');
    }

    await this.bus.publish({
      type: 'StudyAccessed',
      studyId: found.id,
      studyInstanceUid: found.study_instance_uid,
      patientId: found.patient_id,
      accessKind: kind,
      granted: true,
      actorId: ctx.userId,
      actorRole: ctx.role,
      occurredAt: new Date(),
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      studyId: found.id,
      studyInstanceUid: found.study_instance_uid,
      patientId: found.patient_id,
    };
  }

  /**
   * Issue a short-lived, subject-bound URL for one instance.
   *
   * Authorization happens first, so an unauthorised caller never receives a
   * token at all — the signature is not the access-control mechanism, it is
   * what makes an already-authorised grant expire.
   */
  async issueInstanceUrl(
    studyInstanceUid: string,
    sopInstanceUid: string,
  ): Promise<{ url: string; expiresAt: number }> {
    const ctx = requireContext();
    await this.authoriseStudyAccess(studyInstanceUid, 'pixel_data');

    const resource = `/dicom-web/studies/${studyInstanceUid}/instances/${sopInstanceUid}`;
    const { token, expiresAt } = this.signedUrls.sign(resource, ctx.userId);
    return { url: `${resource}?token=${token}`, expiresAt };
  }
}

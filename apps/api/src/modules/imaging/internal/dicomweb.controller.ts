import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { OrthancHttpClient } from './orthanc.http-client';
import { StudyAccessService } from './study-access.service';

/**
 * DICOMweb proxy — BUILD_SPEC P8.2.
 *
 * "The frontend never talks to Orthanc directly. The API proxies
 *  WADO-RS/QIDO-RS requests, and for every request: applies RBAC and RLS,
 *  emits a StudyAccessed audit event, issues short-lived signed URLs."
 *
 * This controller is the ONLY route to imaging data. Orthanc sits in a private
 * subnet with no internet route, so there is no second path for a browser to
 * find — the network topology enforces what this code assumes.
 *
 * Note the shape of every handler: authorise first (which also audits), then
 * fetch. Never the other way round. Fetching first and filtering afterwards
 * would mean the bytes left Orthanc before anyone checked whether they should
 * have, and a bug in the filter becomes a disclosure rather than an error.
 */
@Controller('dicom-web')
export class DicomWebController {
  constructor(
    private readonly access: StudyAccessService,
    private readonly orthanc: OrthancHttpClient,
  ) {}

  /** QIDO-RS: study-level metadata. */
  @RequiresRole('tunisia_doctor', 'libya_doctor', 'patient')
  @Get('studies/:studyUid/metadata')
  @Header('cache-control', 'no-store')
  async studyMetadata(@Param('studyUid') studyUid: string): Promise<unknown> {
    // Throws 404 (and audits the refusal) if the caller may not see it.
    await this.access.authoriseStudyAccess(studyUid, 'metadata');
    return this.orthanc.findStudy(studyUid);
  }

  /**
   * WADO-RS: retrieve the frames of one instance.
   *
   * Streamed rather than buffered — a 120-slice CT held in memory per
   * concurrent viewer exhausts the heap.
   */
  @RequiresRole('tunisia_doctor', 'libya_doctor', 'patient')
  @Get('studies/:studyUid/series/:seriesUid/instances/:sopUid')
  @Header('cache-control', 'no-store')
  async instance(
    @Param('studyUid') studyUid: string,
    @Param('seriesUid') seriesUid: string,
    @Param('sopUid') sopUid: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.access.authoriseStudyAccess(studyUid, 'pixel_data');

    const upstream = await this.orthanc.retrieve(
      `/dicom-web/studies/${encodeURIComponent(studyUid)}` +
        `/series/${encodeURIComponent(seriesUid)}` +
        `/instances/${encodeURIComponent(sopUid)}`,
      'multipart/related; type="application/dicom"',
    );

    if (!upstream.ok || upstream.body === null) {
      // Do not forward Orthanc's status or body: they describe internal state
      // and would distinguish "not in Orthanc" from "not yours" (§6).
      res.status(404).json({ statusCode: 404, message: 'Study not found' });
      return;
    }

    res.status(200);
    res.setHeader(
      'content-type',
      upstream.headers.get('content-type') ?? 'application/dicom',
    );
    // Imaging must never be cached by an intermediary. Even with a signed URL,
    // a shared cache would serve one doctor's study to the next requester.
    res.setHeader('cache-control', 'no-store, private');

    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  }

  /**
   * Issue a short-lived, subject-bound URL for direct retrieval (P8.2).
   *
   * The viewer uses this for progressive frame loading (P9) so it can fetch
   * without re-authorising on every frame — but the URL still expires within
   * 5-15 minutes and is useless to any other account.
   */
  @RequiresRole('tunisia_doctor', 'libya_doctor', 'patient')
  @Get('studies/:studyUid/instances/:sopUid/url')
  @Header('cache-control', 'no-store')
  async instanceUrl(
    @Param('studyUid') studyUid: string,
    @Param('sopUid') sopUid: string,
  ): Promise<{ url: string; expiresAt: number }> {
    return this.access.issueInstanceUrl(studyUid, sopUid);
  }
}

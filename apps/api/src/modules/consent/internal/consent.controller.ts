import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { localeSchema } from '@mir/contracts';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { ConsentService } from './consent.service';

/**
 * Consent HTTP layer — BUILD_SPEC P5.3.
 *
 * CONSENT IS NEVER OPEN-ENDED. `grantedTo` is required, so a patient agrees to
 * a NAMED doctor receiving their imaging, not to "sharing" in the abstract.
 * That is what makes revocation meaningful and what makes the Chapter V
 * position defensible: the decisions file records that a Tunisian doctor's
 * access is a restricted transfer, and a blanket consent could not describe
 * the recipient of one.
 *
 * The client also sends back the exact text it displayed. The service hashes
 * it and refuses if it does not match the published wording — a stale tab
 * showing superseded terms is rejected rather than recorded.
 */

const grantSchema = z.object({
  patientId: z.string().uuid(),
  grantedTo: z.string().uuid(),
  version: z.string().min(1).max(32),
  locale: localeSchema,
  renderedText: z.string().min(1).max(20_000),
  scope: z.string().max(64).optional(),
});

const termsQuerySchema = z.object({
  locale: localeSchema,
  scope: z.string().max(64).optional(),
});

const patientQuerySchema = z.object({ patientId: z.string().uuid() });

@Controller('consent')
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  /**
   * The current published terms.
   *
   * Readable by the patient who must agree and by the referring doctor who
   * explains them. Not public: the wording is versioned evidence, and an
   * unauthenticated endpoint would be one more thing to keep in step.
   */
  @RequiresRole('patient', 'libya_doctor')
  @Get('terms')
  async terms(@Query() query: unknown): Promise<{
    version: string;
    locale: string;
    scope: string;
    body: string;
    contentHash: string;
  }> {
    const { locale, scope } = termsQuerySchema.parse(query);
    const terms = await this.consent.getCurrentTerms(locale, scope);
    return {
      version: terms.version,
      locale: terms.locale,
      scope: terms.scope,
      body: terms.body,
      contentHash: terms.contentHash,
    };
  }

  @RequiresRole('patient', 'libya_doctor')
  @Get()
  async listForPatient(
    @Query() query: unknown,
  ): Promise<{ consents: { consentId: string; grantedTo: string; grantedAt: string }[] }> {
    const { patientId } = patientQuerySchema.parse(query);
    const rows = await this.consent.listActiveForPatient(patientId);
    return {
      consents: rows.map((r) => ({
        consentId: r.consentId,
        grantedTo: r.grantedTo,
        grantedAt: r.grantedAt.toISOString(),
      })),
    };
  }

  /**
   * Only the PATIENT may grant. A doctor cannot consent on a patient's behalf,
   * which is why 'libya_doctor' is absent here despite being able to read the
   * terms above.
   */
  @RequiresRole('patient')
  @Post()
  @HttpCode(201)
  async grant(@Body() body: unknown): Promise<{ consentId: string; evidenceHash: string }> {
    const input = grantSchema.parse(body);
    return this.consent.grant(input);
  }

  @RequiresRole('patient')
  @Delete(':id')
  @HttpCode(204)
  async revoke(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.consent.revoke(id);
  }
}

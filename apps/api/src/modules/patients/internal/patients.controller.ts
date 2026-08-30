import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { RateLimit } from '../../../shared/ratelimit/rate-limit.guard';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import { PatientsService, type CreatePatientResult } from './patients.service';
import type { PatientCandidate } from './patient-matching';

/**
 * Patients HTTP layer — BUILD_SPEC P5.1.
 *
 * Every route declares its access explicitly (P1.5); the app refuses to boot
 * otherwise. Note what these handlers do NOT contain: any ownership filtering.
 * A Libyan doctor sees only their own patients because of row-level security,
 * and the end-to-end tests prove that through this layer rather than trusting
 * the SQL-level tests to carry over.
 */

const createPatientSchema = z.object({
  phoneE164: z.string().min(1),
  fullName: z.string().min(1).max(200),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be YYYY-MM-DD'),
  sex: z.enum(['M', 'F', 'O']),
  nationalId: z.string().max(64).optional(),
  nationalIdType: z.string().max(32).optional(),
  confirmedDistinctFrom: z.array(z.string().uuid()).optional(),
});

const claimSchema = z.object({
  // Six digits, as issued. Length is validated here so a 400 is returned for
  // obvious junk without consuming rate-limit budget on a database round trip.
  token: z.string().regex(/^\d{6}$/, 'token must be six digits'),
});

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  /** Search by phone. Phone only — never by name (P3.3). */
  @RequiresRole('libya_doctor')
  @Get('search')
  async search(@Query('phone') phone: string): Promise<{ candidates: PatientCandidate[] }> {
    const candidates = await this.patients.findByPhone(phone ?? '');
    return { candidates };
  }

  @RequiresRole('libya_doctor')
  @Get()
  async list(): Promise<{ patients: PatientCandidate[] }> {
    return { patients: await this.patients.list() };
  }

  /**
   * Create a patient.
   *
   * Returns 200 with `confirmation_required` when the phone already exists —
   * not an error, because the doctor has a decision to make. Creating on a
   * phone match without asking would be the silent merge P3.3 forbids.
   */
  @RequiresRole('libya_doctor')
  @Post()
  @HttpCode(200)
  async create(@Body() body: unknown): Promise<CreatePatientResult> {
    const input = createPatientSchema.parse(body);
    return this.patients.create(input);
  }

  @RequiresRole('libya_doctor', 'patient', 'tunisia_doctor')
  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<PatientCandidate> {
    // 404 for records the caller cannot see, never 403 (§6).
    return this.patients.getById(id);
  }

  /**
   * Issue a claim code, for delivery by SMS (P5.2).
   *
   * The plaintext code is deliberately NOT returned in the response body in
   * production — it goes to the notifications module and out by SMS, so that
   * possession of the doctor's session is not by itself possession of the
   * patient's claim credential.
   */
  @RequiresRole('libya_doctor')
  // Each call sends an SMS. Unthrottled, this is a billing attack and a way to
  // train a patient to ignore their claim messages (P4.5).
  //
  // Keyed on the PATIENT, not the doctor: the budget protects one phone from
  // being bombed. Keyed on the doctor it would throttle a clinic legitimately
  // onboarding four patients in a morning.
  @RateLimit('otpRequest', { keyBy: 'param:id' })
  @Post(':id/claim-token')
  @HttpCode(202)
  async issueClaimToken(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ status: 'sent'; expiresAt: string }> {
    const { expiresAt } = await this.patients.issueClaimToken(id);
    return { status: 'sent', expiresAt: expiresAt.toISOString() };
  }

  /** Redeem a claim code as the authenticated patient (P5.2). */
  @RequiresRole('patient')
  // Six digits is a million possibilities. `patients_claim_with_token` already
  // binds redemption to the caller's own phone, so a guess cannot take someone
  // else's record — this bounds the guessing itself rather than relying on
  // that single control (ADR-6, defence in depth).
  @RateLimit('login')
  @Post('claim')
  @HttpCode(200)
  async claim(@Body() body: unknown): Promise<{ patientId: string }> {
    const { token } = claimSchema.parse(body);
    return this.patients.claim(token);
  }
}

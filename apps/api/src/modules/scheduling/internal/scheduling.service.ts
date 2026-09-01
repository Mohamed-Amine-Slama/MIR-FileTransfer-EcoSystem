import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { APP_CONFIG } from '../../../shared/config/config.module';
import type { AppConfig } from '../../../shared/config/config.schema';
import { requireContext } from '../../../shared/context/request-context';
import { DatabaseService, type Tx } from '../../../shared/db/database.service';
import { EventBus } from '../../../shared/events/event-bus';

/**
 * Availability and booking — BUILD_SPEC P10.
 *
 * DOUBLE-BOOKING IS PREVENTED BY THE DATABASE, NOT BY THIS CODE.
 *
 * `scheduling_appointments` carries a gist exclusion constraint (P3.1) that
 * makes two overlapping non-cancelled appointments for one doctor impossible.
 * There is deliberately no "check whether the slot is free, then insert" here:
 * that pattern loses to concurrency every time, and the losing case is two
 * patients told they have the same appointment (§17).
 *
 * What this code does instead is TRANSLATE the constraint violation into a
 * clean 409. The database decides; the application reports.
 *
 * All times are timestamptz in UTC (§6). Display-side conversion happens in
 * the browser — Libya is UTC+2 year-round, Tunisia UTC+1 with no DST, and the
 * offset between them changes nothing here because nothing here is local time.
 */

/** PostgreSQL SQLSTATE for a violated exclusion constraint. */
const EXCLUSION_VIOLATION = '23P01';
const UNIQUE_VIOLATION = '23505';

/**
 * Transient concurrency failures, as opposed to genuine conflicts.
 *
 * 40P01 deadlock_detected, 40001 serialization_failure.
 *
 * These are NOT the same as "someone else took the slot". A deadlock means the
 * database aborted one transaction to break a lock cycle — with a gist
 * exclusion constraint plus RLS policy subqueries, 50 simultaneous bookings
 * genuinely produce lock cycles. The transaction is rolled back cleanly and
 * retrying is both safe and correct: the slot may still be free.
 *
 * Left unhandled, a deadlock propagates as a raw driver error and the losing
 * patient gets a 500 — exactly what P10.2 forbids ("a clean conflict error,
 * not a 500").
 */
const TRANSIENT_CONFLICTS = new Set(['40P01', '40001']);

/** Bounded retries. A slot under this much contention resolves in a few. */
const MAX_BOOKING_ATTEMPTS = 5;

/**
 * Connection-pool exhaustion, which is transient in the same way.
 *
 * Under heavy contention the pool can be fully checked out and `connect()`
 * times out. That error carries no SQLSTATE, so the code check above misses
 * it and a raw driver message reaches the caller — the same "raw database
 * error escapes" failure the deadlock case had, arriving by a different door.
 */
function isTransientConnectionFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /timeout exceeded when trying to connect|Connection terminated|too many clients/i.test(
    message,
  );
}

export interface AvailabilityWindow {
  id: string;
  doctorId: string;
  startsAt: Date;
  endsAt: Date;
  slotMinutes: number;
}

export interface BookingInput {
  patientId: string;
  doctorId: string;
  startsAt: Date;
  endsAt: Date;
  /** Studies to share with this appointment. Consent is still required (P5.3). */
  studyIds?: string[];
}

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
}

/** An appointment plus the names the UI needs, so it need not fan out. */
export interface AppointmentSummary extends Appointment {
  patientName: string;
  doctorName: string;
  studyIds?: string[];
}

export interface DoctorSummary {
  id: string;
  displayName: string;
  specialty: string | null;
  city: string | null;
}

interface AppointmentRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  patient_name: string;
  doctor_name: string;
}

function toSummary(row: AppointmentRow): AppointmentSummary {
  return {
    id: row.id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    patientName: row.patient_name,
    doctorName: row.doctor_name,
  };
}

export class SlotUnavailableError extends ConflictException {
  constructor() {
    super('That appointment slot is no longer available');
  }
}

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly bus: EventBus,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // -------------------------------------------------------------------------
  // P10.1 — availability
  // -------------------------------------------------------------------------

  /** A Tunisian doctor publishes a window of availability. */
  async addAvailability(input: {
    startsAt: Date;
    endsAt: Date;
    slotMinutes?: number;
  }): Promise<AvailabilityWindow> {
    const ctx = requireContext();

    if (input.endsAt <= input.startsAt) {
      throw new ConflictException('Availability must end after it starts');
    }

    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        doctor_id: string;
        starts_at: Date;
        ends_at: Date;
        slot_minutes: number;
      }>(
        `INSERT INTO scheduling_availability (doctor_id, starts_at, ends_at, slot_minutes)
         VALUES ($1, $2, $3, $4)
         RETURNING id, doctor_id, starts_at, ends_at, slot_minutes`,
        [ctx.userId, input.startsAt, input.endsAt, input.slotMinutes ?? 30],
      );
      const row = res.rows[0];
      if (row === undefined) throw new NotFoundException('Could not create availability');
      return {
        id: row.id,
        doctorId: row.doctor_id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        slotMinutes: row.slot_minutes,
      };
    });
  }

  /**
   * Bookable slots for a doctor, as UTC instants.
   *
   * Slots already taken are excluded. This is a CONVENIENCE for the UI, not a
   * guarantee: between listing and booking, someone else may take one. The
   * exclusion constraint is what actually decides, which is why `book()` must
   * handle 23P01 rather than trusting this list.
   */
  async listOpenSlots(doctorId: string, from: Date, to: Date): Promise<{ startsAt: Date; endsAt: Date }[]> {
    return this.db.tx(async (tx) => {
      const windows = await tx.query<{ starts_at: Date; ends_at: Date; slot_minutes: number }>(
        `SELECT starts_at, ends_at, slot_minutes
         FROM scheduling_availability
         WHERE doctor_id = $1 AND ends_at > $2 AND starts_at < $3
         ORDER BY starts_at`,
        [doctorId, from, to],
      );

      const taken = await tx.query<{ starts_at: Date; ends_at: Date }>(
        `SELECT starts_at, ends_at FROM scheduling_appointments
         WHERE doctor_id = $1 AND status <> 'cancelled' AND ends_at > $2 AND starts_at < $3`,
        [doctorId, from, to],
      );

      const slots: { startsAt: Date; endsAt: Date }[] = [];
      for (const w of windows.rows) {
        const step = w.slot_minutes * 60_000;
        for (let t = w.starts_at.getTime(); t + step <= w.ends_at.getTime(); t += step) {
          const startsAt = new Date(t);
          const endsAt = new Date(t + step);
          const overlaps = taken.rows.some(
            (a) => a.starts_at.getTime() < endsAt.getTime() && a.ends_at.getTime() > startsAt.getTime(),
          );
          if (!overlaps) slots.push({ startsAt, endsAt });
        }
      }
      return slots;
    });
  }

  // -------------------------------------------------------------------------
  // P10.2 — booking
  // -------------------------------------------------------------------------

  /**
   * Book a slot.
   *
   * One transaction: insert the appointment, link the studies, emit the event.
   * If the exclusion constraint fires, exactly one concurrent caller has won
   * and everyone else gets a clean 409 — never a 500, and never a second
   * appointment.
   *
   * DECISION D2: the appointment starts at `pending_payment`. Authorisation
   * moves it to `authorised`; capture on the doctor's acceptance moves it to
   * `confirmed`. Imaging stays invisible to the receiving doctor until then
   * unless triage is enabled (D3).
   */
  async book(input: BookingInput): Promise<Appointment> {
    const ctx = requireContext();

    if (input.endsAt <= input.startsAt) {
      throw new ConflictException('Appointment must end after it starts');
    }

    let lastTransient: unknown;
    for (let attempt = 1; attempt <= MAX_BOOKING_ATTEMPTS; attempt++) {
      try {
        return await this.attemptBooking(input, ctx);
      } catch (err) {
        const code = (err as { code?: string }).code;
        const transient =
          (code !== undefined && TRANSIENT_CONFLICTS.has(code)) ||
          isTransientConnectionFailure(err);
        if (transient) {
          lastTransient = err;
          // Jittered backoff. Without jitter the same set of transactions
          // collide again on the next attempt, in the same order.
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 25) + attempt * 10));
          continue;
        }
        throw err;
      }
    }

    // Exhausted retries under sustained contention. Report it as a conflict —
    // it is one, from the patient's point of view — rather than a 500.
    this.logger.warn(
      `booking gave up after ${MAX_BOOKING_ATTEMPTS} attempts under contention: ` +
        `${(lastTransient as { code?: string })?.code ?? 'connection'}`,
    );
    // Still a clean conflict, never a raw driver error (P10.2).
    throw new SlotUnavailableError();
  }

  private async attemptBooking(
    input: BookingInput,
    ctx: ReturnType<typeof requireContext>,
  ): Promise<Appointment> {
    const appointment = await this.db.tx(async (tx: Tx) => {
      let inserted;
      try {
        inserted = await tx.query<{
          id: string;
          patient_id: string;
          doctor_id: string;
          starts_at: Date;
          ends_at: Date;
          status: string;
        }>(
          `INSERT INTO scheduling_appointments
             (patient_id, doctor_id, starts_at, ends_at, status)
           VALUES ($1, $2, $3, $4, 'pending_payment')
           RETURNING id, patient_id, doctor_id, starts_at, ends_at, status`,
          [input.patientId, input.doctorId, input.startsAt, input.endsAt],
        );
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === EXCLUSION_VIOLATION || code === UNIQUE_VIOLATION) {
          // Someone else won the slot. This is the ONLY correct outcome for a
          // loser in a contested booking — a clean conflict, not a 500 and not
          // a duplicate appointment.
          throw new SlotUnavailableError();
        }
        if (code === '42501') {
          // RLS rejected the insert: not this patient's account.
          throw new NotFoundException('Patient not found');
        }
        throw err;
      }

      const row = inserted.rows[0];
      if (row === undefined) throw new NotFoundException('Patient not found');

      const requested = input.studyIds ?? [];
      if (requested.length > 0) {
        // Resolve which of the requested studies the caller can actually see.
        // RLS does the deciding; this query just asks it.
        const visible = await tx.query<{ id: string }>(
          `SELECT id FROM imaging_studies WHERE id = ANY($1::uuid[])`,
          [requested],
        );
        const visibleIds = new Set(visible.rows.map((r) => r.id));

        // FAIL LOUDLY on anything unlinkable, rather than dropping it.
        //
        // Two rejected alternatives:
        //   * inserting blind — a WITH CHECK violation aborts the whole
        //     transaction, so one bad id destroys a legitimate booking;
        //   * silently skipping — the receiving doctor never gets a scan the
        //     patient believed they had shared, and nobody finds out until the
        //     consultation. That is a clinical risk, not a UX wrinkle.
        //
        // 404 rather than 403, so this cannot be used to probe which study ids
        // exist (§6).
        const missing = requested.filter((id) => !visibleIds.has(id));
        if (missing.length > 0) {
          throw new NotFoundException('Study not found');
        }

        for (const studyId of requested) {
          await tx.query(
            `INSERT INTO scheduling_appointment_studies (appointment_id, study_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [row.id, studyId],
          );
        }
      }

      return {
        id: row.id,
        patientId: row.patient_id,
        doctorId: row.doctor_id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.status,
      };
    });

    await this.bus.publish({
      type: 'AppointmentBooked',
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      startsAt: appointment.startsAt,
      actorId: ctx.userId,
      actorRole: ctx.role,
      occurredAt: new Date(),
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return appointment;
  }

  // -------------------------------------------------------------------------
  // Reads for the UI
  //
  // NONE of these filter by caller. Every one is scoped by row-level security:
  // a patient sees their own appointments, a Tunisian doctor sees the ones
  // referred to them, and neither can widen that by changing a parameter,
  // because there is no parameter to change. Adding `WHERE patient_id =
  // $currentUser` here would look safer and would in fact be WEAKER — it would
  // move the decision out of the database and into a line of code that a later
  // refactor can drop (ADR-6).
  // -------------------------------------------------------------------------

  /** Appointments visible to the caller, soonest first. */
  async listAppointments(): Promise<AppointmentSummary[]> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<AppointmentRow>(
        `SELECT a.id, a.patient_id, a.doctor_id, a.starts_at, a.ends_at, a.status,
                p.full_name AS patient_name, d.full_name AS doctor_name
         FROM scheduling_appointments a
         JOIN patients_patients p ON p.id = a.patient_id
         JOIN identity_users d ON d.id = a.doctor_id
         ORDER BY a.starts_at DESC`,
      );
      return res.rows.map(toSummary);
    });
  }

  /** One appointment, with its linked studies. 404 when not visible. */
  async getAppointment(appointmentId: string): Promise<AppointmentSummary> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<AppointmentRow>(
        `SELECT a.id, a.patient_id, a.doctor_id, a.starts_at, a.ends_at, a.status,
                p.full_name AS patient_name, d.full_name AS doctor_name
         FROM scheduling_appointments a
         JOIN patients_patients p ON p.id = a.patient_id
         JOIN identity_users d ON d.id = a.doctor_id
         WHERE a.id = $1`,
        [appointmentId],
      );
      const row = res.rows[0];
      // 404 rather than 403 for a row RLS filtered: §6 requires that "does not
      // exist" and "not yours" be indistinguishable.
      if (row === undefined) throw new NotFoundException('Appointment not found');

      const studies = await tx.query<{ study_id: string }>(
        `SELECT study_id FROM scheduling_appointment_studies WHERE appointment_id = $1`,
        [appointmentId],
      );
      return { ...toSummary(row), studyIds: studies.rows.map((s) => s.study_id) };
    });
  }

  /**
   * Verified Tunisian doctors, for the patient's choice of referral.
   *
   * `verified_at IS NOT NULL` is not cosmetic. The decisions file records that
   * a Tunisian doctor's access is a restricted transfer under Chapter V, and
   * that verified_at must not be set without the transfer safeguards in place.
   * Filtering on it here means an unverified doctor cannot be selected, so no
   * imaging can be routed to one.
   */
  async listDoctors(): Promise<DoctorSummary[]> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        full_name: string;
        specialty: string | null;
        clinic_name: string | null;
      }>(
        `SELECT u.id, u.full_name, p.specialty, p.clinic_name
         FROM identity_users u
         JOIN identity_doctor_profiles p ON p.user_id = u.id
         WHERE u.role = 'tunisia_doctor'
           AND u.status = 'active'
           AND p.verified_at IS NOT NULL
         ORDER BY u.full_name`,
      );
      return res.rows.map((r) => ({
        id: r.id,
        displayName: r.full_name,
        specialty: r.specialty,
        city: r.clinic_name,
      }));
    });
  }

  /** The calling doctor's own published availability windows. */
  async listAvailability(): Promise<AvailabilityWindow[]> {
    return this.db.tx(async (tx) => {
      const res = await tx.query<{
        id: string;
        doctor_id: string;
        starts_at: Date;
        ends_at: Date;
        slot_minutes: number;
      }>(
        `SELECT id, doctor_id, starts_at, ends_at, slot_minutes
         FROM scheduling_availability
         ORDER BY starts_at`,
      );
      return res.rows.map((r) => ({
        id: r.id,
        doctorId: r.doctor_id,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        slotMinutes: r.slot_minutes,
      }));
    });
  }

  /**
   * The receiving doctor declines a referral.
   *
   * Distinct from cancel() only in intent, but the distinction matters to the
   * patient: a declined referral must release the authorisation so they are
   * not charged and the held funds return. The release itself is billing's
   * job, triggered off the resulting state.
   */
  async decline(appointmentId: string): Promise<void> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE scheduling_appointments
         SET status = 'cancelled'
         WHERE id = $1 AND status IN ('pending_payment', 'authorised')`,
        [appointmentId],
      );
      return res.rowCount ?? 0;
    });
    if (changed === 0) throw new NotFoundException('Appointment not found');
  }

  /** Cancel an appointment, freeing the slot for someone else. */
  async cancel(appointmentId: string): Promise<void> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE scheduling_appointments
         SET status = 'cancelled'
         WHERE id = $1 AND status <> 'cancelled'`,
        [appointmentId],
      );
      return res.rowCount ?? 0;
    });

    if (changed === 0) throw new NotFoundException('Appointment not found');
  }

  /**
   * Release appointments whose payment authorisation expired (DECISION D2).
   *
   * An authorisation that is never captured must not hold a slot forever —
   * that is a slot no other patient can book while no money will ever move.
   *
   * The status is `cancelled`, and `cancel_reason` is what distinguishes this
   * from a patient changing their mind. The web client used to carry an
   * `expired` status for the difference, which no query could ever return
   * because nothing writes it — so the branch reading it was dead, and a
   * patient whose payment window lapsed was told, indistinguishably, that
   * their appointment had been cancelled.
   */
  async releaseExpiredAuthorisations(): Promise<number> {
    const windowHours = this.config.PAYMENT_AUTHORIZATION_WINDOW_HOURS;
    return this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE scheduling_appointments
         SET status = 'cancelled', cancel_reason = 'authorisation_expired'
         WHERE status IN ('pending_payment', 'authorised')
           AND created_at < now() - ($1 || ' hours')::interval`,
        [String(windowHours)],
      );
      return res.rowCount ?? 0;
    });
  }
}

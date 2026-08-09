import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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

export class SlotUnavailableError extends ConflictException {
  constructor() {
    super('That appointment slot is no longer available');
  }
}

@Injectable()
export class SchedulingService {
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
   */
  async releaseExpiredAuthorisations(): Promise<number> {
    const windowHours = this.config.PAYMENT_AUTHORIZATION_WINDOW_HOURS;
    return this.db.tx(async (tx) => {
      const res = await tx.query(
        `UPDATE scheduling_appointments
         SET status = 'cancelled'
         WHERE status IN ('pending_payment', 'authorised')
           AND created_at < now() - ($1 || ' hours')::interval`,
        [String(windowHours)],
      );
      return res.rowCount ?? 0;
    });
  }
}

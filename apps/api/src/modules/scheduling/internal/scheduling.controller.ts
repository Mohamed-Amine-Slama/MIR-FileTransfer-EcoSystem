import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { RequiresRole } from '../../../shared/authz/access-metadata';
import {
  SchedulingService,
  type AppointmentSummary,
  type DoctorSummary,
} from './scheduling.service';

/**
 * Scheduling HTTP layer — BUILD_SPEC P10.
 *
 * Every route declares its roles explicitly; P1.5 refuses to boot otherwise.
 *
 * Note what is NOT here: any ownership check. Which appointments come back is
 * decided by row-level security, and the booking race is decided by the
 * exclusion constraint. This layer parses input and shapes output.
 *
 * Dates cross the wire as ISO-8601 strings and are parsed to instants here.
 * A wall-clock string with no offset would be ambiguous between Tripoli and
 * Tunis, which is exactly the class of bug P10.1 exists to rule out.
 */

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

const bookSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  startsAt: isoDate,
  endsAt: isoDate,
  studyIds: z.array(z.string().uuid()).max(50).optional(),
});

const availabilitySchema = z.object({
  startsAt: isoDate,
  endsAt: isoDate,
  // A slot shorter than five minutes is a data-entry slip, not a booking
  // policy, and it would generate thousands of slots for one window.
  slotMinutes: z.number().int().min(5).max(240).optional(),
});

const slotQuerySchema = z.object({ from: isoDate, to: isoDate });

interface AppointmentDto {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  studyIds: string[];
}

function toDto(a: AppointmentSummary): AppointmentDto {
  return {
    id: a.id,
    patientId: a.patientId,
    patientName: a.patientName,
    doctorId: a.doctorId,
    doctorName: a.doctorName,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: a.status,
    studyIds: a.studyIds ?? [],
  };
}

@Controller()
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  // --- doctors and availability -------------------------------------------

  /** Verified Tunisian doctors a patient may be referred to. */
  @RequiresRole('patient', 'libya_doctor')
  @Get('doctors')
  async listDoctors(): Promise<{ doctors: DoctorSummary[] }> {
    return { doctors: await this.scheduling.listDoctors() };
  }

  @RequiresRole('patient', 'libya_doctor')
  @Get('doctors/:id/slots')
  async openSlots(
    @Param('id', ParseUUIDPipe) doctorId: string,
    @Query() query: unknown,
  ): Promise<{ slots: { startsAt: string; endsAt: string }[] }> {
    const { from, to } = slotQuerySchema.parse(query);
    const slots = await this.scheduling.listOpenSlots(doctorId, from, to);
    return {
      slots: slots.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
      })),
    };
  }

  @RequiresRole('tunisia_doctor')
  @Get('availability')
  async listAvailability(): Promise<{
    windows: { id: string; startsAt: string; endsAt: string; slotMinutes: number }[];
  }> {
    const windows = await this.scheduling.listAvailability();
    return {
      windows: windows.map((w) => ({
        id: w.id,
        startsAt: w.startsAt.toISOString(),
        endsAt: w.endsAt.toISOString(),
        slotMinutes: w.slotMinutes,
      })),
    };
  }

  @RequiresRole('tunisia_doctor')
  @Post('availability')
  @HttpCode(201)
  async addAvailability(@Body() body: unknown): Promise<{ id: string }> {
    const input = availabilitySchema.parse(body);
    const window = await this.scheduling.addAvailability(input);
    return { id: window.id };
  }

  // --- appointments --------------------------------------------------------

  @RequiresRole('patient', 'libya_doctor', 'tunisia_doctor')
  @Get('appointments')
  async list(): Promise<{ appointments: AppointmentDto[] }> {
    const rows = await this.scheduling.listAppointments();
    return { appointments: rows.map(toDto) };
  }

  @RequiresRole('patient', 'libya_doctor', 'tunisia_doctor')
  @Get('appointments/:id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<AppointmentDto> {
    return toDto(await this.scheduling.getAppointment(id));
  }

  /**
   * Book a slot.
   *
   * A losing booker gets 409 from SlotUnavailableError, which the global
   * exception filter renders without any driver detail (§6). That is P10.2's
   * gate: a clean conflict, never a 500.
   */
  @RequiresRole('patient', 'libya_doctor')
  @Post('appointments')
  @HttpCode(201)
  async book(@Body() body: unknown): Promise<AppointmentDto> {
    const input = bookSchema.parse(body);
    const appointment = await this.scheduling.book({
      patientId: input.patientId,
      doctorId: input.doctorId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      studyIds: input.studyIds,
    });
    return toDto({
      ...appointment,
      patientName: '',
      doctorName: '',
      studyIds: input.studyIds ?? [],
    });
  }

  @RequiresRole('patient', 'libya_doctor')
  @Delete('appointments/:id')
  @HttpCode(204)
  async cancel(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.scheduling.cancel(id);
  }

  /**
   * The receiving doctor declines. Deliberately NOT paired with accept here —
   * accepting captures money, so it lives with billing, next to the code that
   * moves it.
   */
  @RequiresRole('tunisia_doctor')
  @Post('appointments/:id/decline')
  @HttpCode(200)
  async decline(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'declined' }> {
    await this.scheduling.decline(id);
    return { status: 'declined' };
  }
}

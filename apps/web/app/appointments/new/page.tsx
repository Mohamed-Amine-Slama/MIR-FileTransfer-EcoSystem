'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { api, type Doctor, type Slot, type Study } from '../../../lib/api/endpoints';
import { useDateFormat, useT } from '../../../lib/i18n/provider';
import { useSession } from '../../../lib/session/session';
import { RoleGate } from '../../../components/RoleGate';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  Steps,
} from '../../../components/ui';

/**
 * Booking flow — BUILD_SPEC P10.2, DECISION D2.
 *
 * THE CONFLICT PATH IS THE DESIGN.
 * P10.2's gate is that of fifty simultaneous bookings for one slot, exactly one
 * wins and the rest get a clean 409. That 409 is not an error state to
 * apologise for — it is the expected outcome for every patient but one, and it
 * has to leave them one tap from the next slot. So a conflict re-fetches
 * availability and keeps them on the step, rather than dumping them at the
 * start of the flow or showing a dead end.
 *
 * Steps are separated because each one narrows what the next can offer: a slot
 * only means something for a chosen doctor, and studies can only be attached
 * once there is an appointment to attach them to.
 */
export default function NewAppointmentPage(): React.JSX.Element {
  return (
    <RoleGate allow={['patient', 'libya_doctor']}>
      {/* useSearchParams needs a Suspense boundary for static generation. */}
      <Suspense fallback={<main><Spinner label="…" /></main>}>
        <BookingFlow />
      </Suspense>
    </RoleGate>
  );
}

const HORIZON_DAYS = 21;

function BookingFlow(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const formatDate = useDateFormat();
  const { user } = useSession();
  const searchParams = useSearchParams();

  const patientId = searchParams.get('patientId') ?? user?.patientId ?? null;

  const [step, setStep] = useState(0);
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [selectedStudies, setSelectedStudies] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- step 1: doctors -----------------------------------------------------
  useEffect(() => {
    void (async () => {
      try {
        const { doctors: rows } = await api.scheduling.doctors();
        setDoctors(rows);
      } catch {
        setError(t.genericError);
        setDoctors([]);
      }
    })();
  }, [t]);

  // --- step 2: slots for the chosen doctor ---------------------------------
  const loadSlots = useCallback(
    async (chosen: Doctor) => {
      setSlots(null);
      const from = new Date();
      const to = new Date(from.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000);
      try {
        const { slots: rows } = await api.scheduling.openSlots(
          chosen.id,
          from.toISOString(),
          to.toISOString(),
        );
        setSlots(rows);
      } catch {
        setError(t.genericError);
        setSlots([]);
      }
    },
    [t],
  );

  // --- step 3: the patient's studies ---------------------------------------
  useEffect(() => {
    if (step !== 2 || patientId === null) return;
    void (async () => {
      try {
        const { studies: rows } = await api.imaging.studiesForPatient(patientId);
        setStudies(rows);
      } catch {
        setStudies([]);
      }
    })();
  }, [step, patientId]);

  const confirm = async (): Promise<void> => {
    if (doctor === null || slot === null || patientId === null) return;
    setBusy(true);
    setError(null);
    try {
      const appointment = await api.scheduling.book({
        patientId,
        doctorId: doctor.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        studyIds: selectedStudies,
      });
      // D2: booking creates a pending_payment appointment. Payment is the next
      // screen, not a step inside this one — the appointment exists either way.
      router.push(`/appointments/${appointment.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) {
        // Someone else won the slot. Send them back to a FRESH list rather
        // than leaving the taken slot selected.
        setError(t.bookingSlotTaken);
        setSlot(null);
        setStep(1);
        if (doctor !== null) void loadSlots(doctor);
      } else {
        setError(t.genericError);
      }
    } finally {
      setBusy(false);
    }
  };

  const stepLabels = [t.bookingStepDoctor, t.bookingStepSlot, t.bookingStepStudies, t.bookingStepConfirm];

  return (
    <main className="stack">
      <PageHeader title={t.bookingTitle} />
      <Steps steps={stepLabels} current={step} />

      {error !== null && (
        <Alert tone={error === t.bookingSlotTaken ? 'warning' : 'danger'} testId="booking-error">
          {error}
        </Alert>
      )}

      {patientId === null && <Alert tone="warning">{t.claimDescription}</Alert>}

      {/* ---- step 1: doctor ---- */}
      {step === 0 && (
        <Card title={t.bookingStepDoctor}>
          {doctors === null ? (
            <Spinner label={t.loading} />
          ) : doctors.length === 0 ? (
            <EmptyState>{t.none}</EmptyState>
          ) : (
            <ul className="list" data-testid="doctor-list">
              {doctors.map((d) => (
                <li key={d.id} className="list__item">
                  <span style={{ flex: 1 }}>{d.displayName}</span>
                  <span className="muted small">{d.specialty ?? ''}</span>
                  <Button
                    size="sm"
                    data-testid="choose-doctor"
                    onClick={() => {
                      setDoctor(d);
                      setStep(1);
                      void loadSlots(d);
                    }}
                  >
                    {t.next}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ---- step 2: slot ---- */}
      {step === 1 && doctor !== null && (
        <Card
          title={t.bookingStepSlot}
          actions={
            <Button size="sm" onClick={() => setStep(0)}>
              {t.back}
            </Button>
          }
        >
          {slots === null ? (
            <Spinner label={t.loading} />
          ) : slots.length === 0 ? (
            <EmptyState testId="no-slots">{t.bookingNoSlots}</EmptyState>
          ) : (
            <ul className="list" data-testid="slot-list">
              {slots.map((s) => (
                <li key={s.startsAt} className="list__item">
                  <span style={{ flex: 1 }}>{formatDate(s.startsAt)}</span>
                  <Button
                    size="sm"
                    data-testid="choose-slot"
                    onClick={() => {
                      setSlot(s);
                      setStep(2);
                    }}
                  >
                    {t.next}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ---- step 3: studies ---- */}
      {step === 2 && (
        <Card
          title={t.bookingStepStudies}
          actions={
            <Button size="sm" onClick={() => setStep(1)}>
              {t.back}
            </Button>
          }
        >
          <div className="stack-sm">
            {studies.length === 0 ? (
              <EmptyState>{t.none}</EmptyState>
            ) : (
              <ul className="list" data-testid="study-picker">
                {studies.map((s) => (
                  <li key={s.id} className="list__item">
                    <label className="row" style={{ flex: 1 }}>
                      <input
                        type="checkbox"
                        data-testid="study-checkbox"
                        checked={selectedStudies.includes(s.id)}
                        onChange={(e) =>
                          setSelectedStudies((prev) =>
                            e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id),
                          )
                        }
                      />
                      <span>{s.description ?? s.studyInstanceUid}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="primary" data-testid="studies-next" onClick={() => setStep(3)}>
              {t.next}
            </Button>
          </div>
        </Card>
      )}

      {/* ---- step 4: confirm ---- */}
      {step === 3 && doctor !== null && slot !== null && (
        <Card
          title={t.bookingStepConfirm}
          actions={
            <Button size="sm" onClick={() => setStep(2)}>
              {t.back}
            </Button>
          }
        >
          <div className="stack-sm">
            <p>
              <strong>{t.bookingDoctor}:</strong> {doctor.displayName}
            </p>
            <p>
              <strong>{t.bookingSlot}:</strong> {formatDate(slot.startsAt)}
            </p>
            <p>
              <strong>{t.patientStudies}:</strong> {selectedStudies.length}
            </p>
            <Alert tone="info">{t.checkoutDescription}</Alert>
            <Button
              variant="primary"
              data-testid="confirm-booking"
              disabled={busy || patientId === null}
              onClick={() => void confirm()}
            >
              {t.bookingConfirm}
            </Button>
          </div>
        </Card>
      )}
    </main>
  );
}

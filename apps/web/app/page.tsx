'use client';

import Link from 'next/link';
import type { Role } from '@mir/contracts';
import { useT } from '../lib/i18n/provider';
import { useSession } from '../lib/session/session';
import { Card, PageHeader, Spinner } from '../components/ui';

/**
 * Landing screen.
 *
 * Routes each role to the one thing they came to do rather than showing a
 * dashboard of everything. The three roles have almost no overlap in daily
 * work: the Libyan doctor manages patients and uploads, the patient tracks
 * appointments, the Tunisian doctor works an inbox.
 */
export default function Home(): React.JSX.Element {
  const t = useT();
  const { status, user, role } = useSession();

  return (
    <main className="stack">
      <PageHeader title={t.appName} description={t.appTagline} />

      {status === 'loading' && <Spinner label={t.loading} />}

      {status === 'anonymous' && (
        <Card title={t.signInTitle}>
          <p className="muted">{t.signInDescription}</p>
          <Link href="/login" className="btn btn--primary" data-testid="home-sign-in">
            {t.navSignIn}
          </Link>
        </Card>
      )}

      {status === 'authenticated' && role !== null && (
        <div className="grid" data-testid="home-actions">
          {destinationsFor(role).map((d) => (
            <Card key={d.href} title={label(d.key, t)}>
              <p className="muted small">{description(d.key, t)}</p>
              <Link href={d.href} className="btn" data-testid={`home-link-${d.key}`}>
                {label(d.key, t)}
              </Link>
            </Card>
          ))}
          {role === 'patient' && user?.patientId === undefined && (
            <Card title={t.claimTitle}>
              <p className="muted small">{t.claimDescription}</p>
              <Link href="/claim" className="btn btn--primary" data-testid="home-link-claim">
                {t.claimSubmit}
              </Link>
            </Card>
          )}
        </div>
      )}
    </main>
  );
}

type DestinationKey =
  | 'patients'
  | 'upload'
  | 'appointments'
  | 'inbox'
  | 'availability'
  | 'audit';

function destinationsFor(role: Role): { key: DestinationKey; href: string }[] {
  switch (role) {
    case 'libya_doctor':
      return [
        { key: 'patients', href: '/patients' },
        { key: 'upload', href: '/upload' },
        { key: 'appointments', href: '/appointments' },
      ];
    case 'patient':
      return [{ key: 'appointments', href: '/appointments' }];
    case 'tunisia_doctor':
      return [
        { key: 'inbox', href: '/doctor' },
        { key: 'availability', href: '/doctor/availability' },
      ];
    case 'admin':
      return [{ key: 'audit', href: '/admin/audit' }];
  }
}

function label(key: DestinationKey, t: ReturnType<typeof useT>): string {
  const map: Record<DestinationKey, string> = {
    patients: t.navPatients,
    upload: t.navUpload,
    appointments: t.navAppointments,
    inbox: t.navInbox,
    availability: t.navAvailability,
    audit: t.navAudit,
  };
  return map[key];
}

function description(key: DestinationKey, t: ReturnType<typeof useT>): string {
  const map: Record<DestinationKey, string> = {
    patients: t.patientsDescription,
    upload: t.appTagline,
    appointments: t.appointmentsTitle,
    inbox: t.inboxTitle,
    availability: t.availabilityDescription,
    audit: t.auditDescription,
  };
  return map[key];
}

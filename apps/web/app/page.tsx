'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Banknote,
  Briefcase,
  Building2,
  CalendarDays,
  FolderKanban,
  Inbox,
  ScrollText,
  ShieldCheck,
  Upload,
  UserRoundPlus,
  Users,
} from 'lucide-react';
import type { Role } from '@mir/contracts';
import { api, type Appointment, type AuditEvent } from '../lib/api/endpoints';
import { useDateFormat, useT } from '../lib/i18n/provider';
import type { Dictionary } from '../lib/i18n/dictionary';
import { sideForRole } from '../lib/corridor/registry';
import { useSession } from '../lib/session/session';
import { AppointmentStatusBadge } from '../components/AppointmentStatusBadge';
import { Landing } from '../components/marketing/Landing';
import {
import { isLiveAppointment } from '../lib/scheduling/status';
  Card,
  EmptyState,
  PageHeader,
  Main,
  SectionHeading,
  Skeleton,
  StatGrid,
  StatTile,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from '../components/ui';

/**
 * Landing screen — a per-role dashboard.
 *
 * Every number here is computed CLIENT-SIDE from the same list endpoints the
 * worklists read, so a tile can never disagree with the list behind it. The
 * API has no aggregate endpoints, and adding them for a landing page would
 * create a second source of truth for counts an admin will compare.
 *
 * Every fetch fails soft: the quick-action links render regardless, because
 * the dashboard's one non-negotiable job is routing each role to their work.
 */
export default function Home(): React.JSX.Element {
  const t = useT();
  const { status, user, role } = useSession();

  /*
   * `/` IS TWO PAGES. A visitor gets the landing page; a signed-in user gets
   * their dashboard. AppShell picks the chrome off the same distinction, so the
   * marketing header and the application sidebar never appear together.
   *
   * The loading state renders the landing page rather than a spinner: it is
   * correct for everyone who is not signed in, it is what most arrivals at this
   * URL are, and a spinner on the front door is a worse first impression than a
   * page that is briefly replaced.
   */
  if (status !== 'authenticated') return <Landing />;

  return (
    <Main wide>
      <PageHeader title={t.appName} description={t.appTagline} />

      {status === 'authenticated' && role !== null && (
        <>
          {role === 'patient' && user?.patientId === undefined && (
            <Card title={t.claimTitle} className="border-info/40">
              <p className="text-sm text-muted-foreground">{t.claimDescription}</p>
              <Link href="/claim" className={buttonVariants()} data-testid="home-link-claim">
                {t.claimSubmit}
              </Link>
            </Card>
          )}

          {role === 'libya_doctor' && <LibyaDoctorDashboard />}
          {role === 'patient' && <PatientDashboard />}
          {role === 'tunisia_doctor' && <TunisiaDoctorDashboard />}
          {role === 'admin' && <AdminDashboard />}

          <QuickActions role={role} />
        </>
      )}
    </Main>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function AppointmentsMiniTable({
  appointments,
  title,
  nameOf,
}: {
  appointments: Appointment[];
  title: string;
  nameOf?: (a: Appointment) => string;
}): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  const recent = appointments.slice(0, 5);

  return (
    <Card
      title={title}
      actions={
        <Link href="/appointments" className="text-sm font-medium text-primary hover:underline">
          {t.dashboardViewAll}
        </Link>
      }
    >
      {recent.length === 0 ? (
        <EmptyState>{t.appointmentsEmpty}</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.colDate}</TableHead>
              {nameOf !== undefined && <TableHead>{t.colPatient}</TableHead>}
              <TableHead>{t.appointmentStatus}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/appointments/${a.id}`}
                    className="rounded-sm hover:text-primary hover:underline"
                  >
                    {formatDate(a.startsAt)}
                  </Link>
                </TableCell>
                {nameOf !== undefined && (
                  <TableCell className="text-muted-foreground">{nameOf(a)}</TableCell>
                )}
                <TableCell>
                  <AppointmentStatusBadge status={a.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Role dashboards
// ---------------------------------------------------------------------------

function useAppointments(): Appointment[] | null {
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const { appointments: rows } = await api.scheduling.listAppointments();
        setAppointments(rows);
      } catch {
        setAppointments([]); // Fail soft: tiles show 0, links still work.
      }
    })();
  }, []);
  return appointments;
}

function LibyaDoctorDashboard(): React.JSX.Element {
  const t = useT();
  const appointments = useAppointments();
  const [patientCount, setPatientCount] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { patients } = await api.patients.list();
        setPatientCount(patients.length);
      } catch {
        setPatientCount(0);
      }
    })();
  }, []);

  const count = (s: Appointment['status']): number | null =>
    appointments === null ? null : appointments.filter((a) => a.status === s).length;

  return (
    <>
      <StatGrid>
        {/* Each tile links to the list its number came from. A count with no
            way through to the rows behind it is a fact nobody can act on. */}
        <StatTile label={t.statPatients} value={patientCount} href="/patients" />
        <StatTile
          label={t.statAppointmentsTotal}
          value={appointments === null ? null : appointments.length}
          href="/appointments"
        />
        <StatTile label={t.statusAuthorised} value={count('authorised')} href="/appointments" />
        <StatTile label={t.statusConfirmed} value={count('confirmed')} href="/appointments" />
      </StatGrid>
      {appointments !== null && (
        <AppointmentsMiniTable appointments={appointments} title={t.dashboardRecent} />
      )}
    </>
  );
}

function PatientDashboard(): React.JSX.Element {
  const t = useT();
  const formatDate = useDateFormat();
  const appointments = useAppointments();

  const upcoming =
    appointments === null
      ? null
      : (appointments
          .filter(
            (a) =>
              new Date(a.startsAt).getTime() > Date.now() && isLiveAppointment(a.status),
          )
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null);

  return (
    <>
      <Card title={t.dashboardUpcoming}>
        {appointments === null ? (
          <Skeleton className="h-12 w-full max-w-sm" />
        ) : upcoming === null ? (
          <EmptyState>{t.dashboardNoUpcoming}</EmptyState>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/appointments/${upcoming.id}`}
              className="text-lg font-semibold tabular-nums hover:text-primary hover:underline"
            >
              {formatDate(upcoming.startsAt)}
            </Link>
            <span className="text-sm text-muted-foreground">
              {upcoming.doctorName ?? upcoming.doctorId}
            </span>
            <AppointmentStatusBadge status={upcoming.status} />
          </div>
        )}
      </Card>
      {appointments !== null && (
        <AppointmentsMiniTable appointments={appointments} title={t.dashboardRecent} />
      )}
    </>
  );
}

function TunisiaDoctorDashboard(): React.JSX.Element {
  const t = useT();
  const appointments = useAppointments();

  const count = (s: Appointment['status']): number | null =>
    appointments === null ? null : appointments.filter((a) => a.status === s).length;

  const awaiting =
    appointments === null ? [] : appointments.filter((a) => a.status === 'authorised');

  return (
    <>
      <StatGrid>
        <StatTile label={t.dashboardAwaitingDecision} value={count('authorised')} href="/doctor" />
        <StatTile label={t.statusConfirmed} value={count('confirmed')} href="/appointments" />
        <StatTile
          label={t.statAppointmentsTotal}
          value={appointments === null ? null : appointments.length}
          href="/appointments"
        />
      </StatGrid>
      {appointments !== null && awaiting.length > 0 && (
        <AppointmentsMiniTable
          appointments={awaiting}
          title={t.dashboardAwaitingDecision}
          nameOf={(a) => a.patientName ?? a.patientId}
        />
      )}
    </>
  );
}

function AdminDashboard(): React.JSX.Element {
  const t = useT();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { events: rows } = await api.audit.recent();
        setEvents(rows);
      } catch {
        setEvents([]);
      }
    })();
  }, []);

  const count = (outcome: AuditEvent['outcome']): number | null =>
    events === null ? null : events.filter((e) => e.outcome === outcome).length;

  return (
    <StatGrid>
      <StatTile label={t.auditAllowed} value={count('allowed')} href="/admin/audit" />
      <StatTile label={t.auditDenied} value={count('denied')} href="/admin/audit" />
    </StatGrid>
  );
}

// ---------------------------------------------------------------------------
// Quick actions — the routing job. Rendered for every role, even when every
// fetch above failed, and the testids are the ones the e2e suite knows.
// ---------------------------------------------------------------------------

type DestinationKey =
  | 'patients'
  | 'upload'
  | 'appointments'
  | 'consents'
  | 'inbox'
  | 'availability'
  | 'audit'
  | 'workspace'
  | 'cases'
  | 'ledger'
  | 'adminCases'
  | 'adminProviders'
  | 'adminLedger';

const DESTINATION_ICONS: Record<DestinationKey, typeof Users> = {
  patients: Users,
  upload: Upload,
  appointments: CalendarDays,
  consents: ShieldCheck,
  inbox: Inbox,
  availability: UserRoundPlus,
  audit: ScrollText,
  workspace: Briefcase,
  cases: FolderKanban,
  ledger: Banknote,
  adminCases: FolderKanban,
  adminProviders: Building2,
  adminLedger: Banknote,
};

/**
 * The case-layer destinations, chosen by corridor SIDE rather than by role
 * name (§4.3).
 *
 * Kept separate from `destinationsFor` below on purpose: that switch is V0's,
 * it branches on role literals, and it is on the §4.3 debt allowlist. Adding
 * corridor-aware entries to it would deepen the debt rather than work around
 * it. This function names no country and no role, so it stays correct when a
 * second corridor is configured.
 */
function corridorDestinationsFor(role: Role): { key: DestinationKey; href: string }[] {
  const side = sideForRole(role);
  if (side === null) return [];
  if (side === 'ops') {
    return [
      { key: 'adminCases', href: '/admin/cases' },
      { key: 'adminProviders', href: '/admin/providers' },
      { key: 'adminLedger', href: '/admin/ledger' },
    ];
  }
  return [
    { key: 'workspace', href: '/workspace' },
    { key: 'cases', href: '/cases' },
    { key: 'ledger', href: '/ledger' },
  ];
}

function destinationsFor(role: Role): { key: DestinationKey; href: string }[] {
  switch (role) {
    case 'libya_doctor':
      return [
        { key: 'patients', href: '/patients' },
        { key: 'upload', href: '/upload' },
        { key: 'appointments', href: '/appointments' },
      ];
    case 'patient':
      return [
        { key: 'appointments', href: '/appointments' },
        { key: 'consents', href: '/consent' },
      ];
    case 'tunisia_doctor':
      return [
        { key: 'inbox', href: '/doctor' },
        { key: 'availability', href: '/doctor/availability' },
      ];
    case 'admin':
      return [{ key: 'audit', href: '/admin/audit' }];
    case 'applicant':
      // An applicant has no destinations. Their whole screen is the
      // verification status, which the dashboard surfaces directly rather than
      // as one card among several.
      return [];
  }
}

function label(key: DestinationKey, t: Dictionary): string {
  const map: Record<DestinationKey, string> = {
    patients: t.navPatients,
    upload: t.navUpload,
    appointments: t.navAppointments,
    consents: t.navConsents,
    inbox: t.navInbox,
    availability: t.navAvailability,
    workspace: t.navWorkspace,
    cases: t.navCases,
    ledger: t.navLedger,
    adminCases: t.navAdminCases,
    adminProviders: t.navAdminProviders,
    adminLedger: t.navAdminLedger,
    audit: t.navAudit,
  };
  return map[key];
}

function description(key: DestinationKey, t: Dictionary): string {
  const map: Record<DestinationKey, string> = {
    patients: t.patientsDescription,
    upload: t.uploadHint,
    appointments: t.bookingTitle,
    consents: t.consentDescription,
    inbox: t.inboxTitle,
    availability: t.availabilityDescription,
    audit: t.auditDescription,
    workspace: t.workspaceDescription,
    cases: t.casesDescription,
    ledger: t.ledgerDescription,
    adminCases: t.adminCasesDescription,
    adminProviders: t.adminProvidersDescription,
    adminLedger: t.adminLedgerDescription,
  };
  return map[key];
}

function QuickActions({ role }: { role: Role }): React.JSX.Element {
  const t = useT();
  return (
    <section>
      <SectionHeading>{t.dashboardQuickActions}</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="home-actions">
        {/* Corridor destinations first: a provider's day starts with their
            caseload, not with the patient index. */}
        {[...corridorDestinationsFor(role), ...destinationsFor(role)].map((d) => {
          const Icon = DESTINATION_ICONS[d.key];
          return (
            <Link
              key={d.href}
              href={d.href}
              data-testid={`home-link-${d.key}`}
              className="group flex flex-col gap-1.5 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-primary"
            >
              <span className="flex items-center gap-2 font-semibold group-hover:text-primary">
                <Icon className="size-4.5 text-primary" aria-hidden="true" />
                {label(d.key, t)}
              </span>
              <span className="text-sm text-muted-foreground">{description(d.key, t)}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

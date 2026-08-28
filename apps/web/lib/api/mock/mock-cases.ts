import {
  canTransition,
  caseEventSchema,
  caseSchema,
  formatCaseRef,
  messageSchema,
  providerSchema,
  type Case,
  type CaseEvent,
  type CaseStatus,
  type LedgerEntry,
  type Message,
  type Notification,
  type Provider,
} from '@mir/contracts';
import type {
  CasesApi,
  ListCasesQuery,
  RegisterProviderInput,
  SubmitCaseInput,
} from '../cases';
import {
  FIXTURE_CASES,
  FIXTURE_EVENTS,
  FIXTURE_LEDGER,
  FIXTURE_MESSAGES,
  FIXTURE_NOTIFICATIONS,
  FIXTURE_PROVIDERS,
} from './fixtures';

/**
 * Fixture-backed implementation of CasesApi.
 *
 * Async on purpose even though nothing awaits: screens written against this
 * must handle loading states, or every one of them needs rewriting the day the
 * real client lands.
 *
 * Mutations are held in module-level arrays seeded from the fixtures. They
 * survive client-side navigation and are lost on reload, which is the right
 * lifetime for a development stand-in — nothing here may look like durable
 * storage, because a screen that appears to persist would hide the fact that
 * the write path does not exist yet.
 *
 * The provider filter mirrors what the backend's RLS will enforce. It is here
 * so a screen developed against mocks cannot accidentally come to rely on
 * seeing another provider's cases.
 */

const cases: Case[] = [...FIXTURE_CASES];
const events: CaseEvent[] = [...FIXTURE_EVENTS];
const messages: Message[] = [...FIXTURE_MESSAGES];
const notifications: Notification[] = [...FIXTURE_NOTIFICATIONS];
const providers: Provider[] = [...FIXTURE_PROVIDERS];

function visibleTo(item: Case, providerId: string): boolean {
  return item.submittedByProviderId === providerId || item.matchedProviderId === providerId;
}

/** Next free sequence for the current year, so references never collide. */
function nextRef(): string {
  const year = new Date().getUTCFullYear();
  const used = cases
    .map((c) => c.ref)
    .filter((ref) => ref.startsWith(`MIR-${year}-`))
    .map((ref) => Number(ref.slice(-4)));
  return formatCaseRef(year, Math.max(0, ...used) + 1);
}

function requireCase(ref: string): Case {
  const found = cases.find((c) => c.ref === ref);
  if (found === undefined) throw new Error(`no such case: ${ref}`);
  return found;
}

export const mockCasesApi: CasesApi = {
  async listCases(query: ListCasesQuery): Promise<Case[]> {
    return cases.filter(
      (c) =>
        visibleTo(c, query.providerId) &&
        (query.status === undefined || c.status === query.status) &&
        (query.search === undefined ||
          query.search === '' ||
          c.ref.toLowerCase().includes(query.search.toLowerCase())),
    );
  },

  async getCase(ref: string): Promise<Case | null> {
    return cases.find((c) => c.ref === ref) ?? null;
  },

  async listCaseEvents(ref: string): Promise<CaseEvent[]> {
    return events
      .filter((e) => e.caseRef === ref)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  },

  async submitCase(input: SubmitCaseInput): Promise<Case> {
    const now = new Date().toISOString();
    const created = caseSchema.parse({
      ref: nextRef(),
      corridorId: input.corridorId,
      status: 'submitted',
      submittedByProviderId: input.providerId,
      patientId: input.patientId,
      studyIds: [],
      createdAt: now,
      updatedAt: now,
      intake: input.intake,
    });
    cases.unshift(created);
    events.push(
      caseEventSchema.parse({
        id: `ev-${created.ref}-1`,
        caseRef: created.ref,
        occurredAt: now,
        actorDisplayName: providers.find((p) => p.id === input.providerId)?.legalName ?? 'Provider',
        actorSide: 'source',
        from: null,
        to: 'submitted',
      }),
    );
    return created;
  },

  async changeCaseStatus(ref: string, to: CaseStatus, actorDisplayName: string): Promise<Case> {
    const existing = requireCase(ref);
    // Refused rather than coerced: an ops tool that can force any status is a
    // tool that can silently undo a coordination fee (§5.7).
    if (!canTransition(existing.status, to)) {
      throw new Error(`illegal transition: ${existing.status} -> ${to}`);
    }
    const now = new Date().toISOString();
    events.push(
      caseEventSchema.parse({
        id: `ev-${ref}-${events.filter((e) => e.caseRef === ref).length + 1}`,
        caseRef: ref,
        occurredAt: now,
        actorDisplayName,
        actorSide: 'ops',
        from: existing.status,
        to,
      }),
    );
    const updated: Case = { ...existing, status: to, updatedAt: now };
    cases[cases.indexOf(existing)] = updated;
    return updated;
  },

  async listLedger(providerId: string): Promise<LedgerEntry[]> {
    // The fixtures model a single billed provider; the argument is kept so the
    // signature matches the real client exactly.
    return providerId === 'prov-source-1' ? FIXTURE_LEDGER.slice() : [];
  },

  async listAllLedger(): Promise<{ providerId: string; entries: LedgerEntry[] }[]> {
    return providers.map((p) => ({
      providerId: p.id,
      entries: p.id === 'prov-source-1' ? FIXTURE_LEDGER.slice() : [],
    }));
  },

  async listMessages(ref: string): Promise<Message[]> {
    return messages
      .filter((m) => m.caseRef === ref)
      .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
  },

  async sendMessage(ref: string, body: string, authorDisplayName: string): Promise<Message> {
    const now = new Date().toISOString();
    const created = messageSchema.parse({
      id: `msg-${messages.length + 1}`,
      caseRef: ref,
      authorSide: 'source',
      authorDisplayName,
      body,
      sentAt: now,
      deliveredAt: now,
    });
    messages.push(created);
    return created;
  },

  async listNotifications(): Promise<Notification[]> {
    return notifications
      .slice()
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  },

  async markNotificationRead(id: string): Promise<void> {
    const index = notifications.findIndex((n) => n.id === id);
    const existing = notifications[index];
    if (existing === undefined) return;
    notifications[index] = { ...existing, readAt: new Date().toISOString() };
  },

  async getProvider(id: string): Promise<Provider | null> {
    return providers.find((p) => p.id === id) ?? null;
  },

  async listProviders(): Promise<Provider[]> {
    return providers.slice();
  },

  async listVerificationQueue(): Promise<Provider[]> {
    return providers.filter((p) => p.verification.status === 'pending');
  },

  async registerProvider(input: RegisterProviderInput): Promise<Provider> {
    const created = providerSchema.parse({
      id: `prov-${providers.length + 1}`,
      kind: input.kind,
      legalName: input.legalName,
      corridorId: input.corridorId,
      side: input.side,
      verification: {
        status: 'pending',
        submittedAt: new Date().toISOString(),
        credentials: input.credentials,
      },
      seatCount: input.seatCount,
    });
    providers.push(created);
    return created;
  },

  async decideVerification(id: string, approve: boolean, reasonKey?: string): Promise<Provider> {
    const existing = providers.find((p) => p.id === id);
    if (existing === undefined) throw new Error(`no such provider: ${id}`);
    const updated = providerSchema.parse({
      ...existing,
      verification: {
        ...existing.verification,
        status: approve ? 'approved' : 'rejected',
        decidedAt: new Date().toISOString(),
        ...(reasonKey === undefined ? {} : { reasonKey }),
      },
    });
    providers[providers.indexOf(existing)] = updated;
    return updated;
  },

  async listAllCases(status?: CaseStatus): Promise<Case[]> {
    return cases.filter((c) => status === undefined || c.status === status);
  },
};

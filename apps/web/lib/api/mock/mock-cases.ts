import type {
  Case,
  CaseEvent,
  CaseStatus,
  LedgerEntry,
  Message,
  Notification,
  Provider,
} from '@mir/contracts';
import type { CasesApi, ListCasesQuery } from '../cases';
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
 * The provider filter mirrors what the backend's RLS will enforce. It is here
 * so a screen developed against mocks cannot accidentally come to rely on
 * seeing another provider's cases.
 */

function visibleTo(item: Case, providerId: string): boolean {
  return item.submittedByProviderId === providerId || item.matchedProviderId === providerId;
}

export const mockCasesApi: CasesApi = {
  async listCases(query: ListCasesQuery): Promise<Case[]> {
    return FIXTURE_CASES.filter(
      (c) =>
        visibleTo(c, query.providerId) &&
        (query.status === undefined || c.status === query.status) &&
        (query.search === undefined ||
          c.ref.toLowerCase().includes(query.search.toLowerCase())),
    ).slice();
  },

  async getCase(ref: string): Promise<Case | null> {
    return FIXTURE_CASES.find((c) => c.ref === ref) ?? null;
  },

  async listCaseEvents(ref: string): Promise<CaseEvent[]> {
    return FIXTURE_EVENTS.filter((e) => e.caseRef === ref).sort(
      (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
    );
  },

  async listLedger(providerId: string): Promise<LedgerEntry[]> {
    // The fixtures model a single billed provider; the argument is kept so the
    // signature matches the real client exactly.
    return providerId === 'prov-source-1' ? FIXTURE_LEDGER.slice() : [];
  },

  async listMessages(ref: string): Promise<Message[]> {
    return FIXTURE_MESSAGES.filter((m) => m.caseRef === ref).sort(
      (a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt),
    );
  },

  async listNotifications(): Promise<Notification[]> {
    return FIXTURE_NOTIFICATIONS.slice().sort(
      (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
    );
  },

  async getProvider(id: string): Promise<Provider | null> {
    return FIXTURE_PROVIDERS.find((p) => p.id === id) ?? null;
  },

  async listVerificationQueue(): Promise<Provider[]> {
    return FIXTURE_PROVIDERS.filter((p) => p.verification.status === 'pending');
  },

  async listAllCases(status?: CaseStatus): Promise<Case[]> {
    return FIXTURE_CASES.filter((c) => status === undefined || c.status === status).slice();
  },
};

import type {
  Case,
  CaseEvent,
  CaseStatus,
  LedgerEntry,
  Message,
  Notification,
  Provider,
} from '@mir/contracts';

/**
 * The case-layer API surface.
 *
 * One interface, two implementations. Screens import the surface and never
 * learn which one they got, so replacing fixtures with the real client is a
 * change to this file alone.
 */

export interface ListCasesQuery {
  providerId: string;
  status?: CaseStatus;
  /** Matches on case reference — the §5.3 provider search. */
  search?: string;
}

export interface CasesApi {
  listCases(query: ListCasesQuery): Promise<Case[]>;
  getCase(ref: string): Promise<Case | null>;
  listCaseEvents(ref: string): Promise<CaseEvent[]>;
  listLedger(providerId: string): Promise<LedgerEntry[]>;
  listMessages(ref: string): Promise<Message[]>;
  listNotifications(): Promise<Notification[]>;
  getProvider(id: string): Promise<Provider | null>;
  listVerificationQueue(): Promise<Provider[]>;
  /** §5.8: the ops pipeline across all providers, not one provider's list. */
  listAllCases(status?: CaseStatus): Promise<Case[]>;
}

/**
 * Defaults to LIVE. A missing or misspelled environment variable must never
 * silently serve fixtures to a clinic — the failure mode of the opposite
 * default is invented patients on a real screen.
 */
export function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_MIR_API_MODE === 'mock';
}

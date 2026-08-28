import type {
  Case,
  CaseEvent,
  CaseStatus,
  LedgerEntry,
  Message,
  Notification,
  Provider,
  ProviderKind,
} from '@mir/contracts';

/**
 * The case-layer API surface.
 *
 * One interface, two implementations. Screens import `casesApi` and never learn
 * which one they got, so replacing fixtures with the real client is a change to
 * this file alone.
 */

export interface ListCasesQuery {
  providerId: string;
  status?: CaseStatus;
  /** Matches on case reference — the §5.3 provider search. */
  search?: string;
}

export interface SubmitCaseInput {
  providerId: string;
  corridorId: string;
  patientId: string;
  /** Values keyed by the corridor's intakeFields (§4.3). */
  intake: Record<string, unknown>;
}

export interface RegisterProviderInput {
  kind: ProviderKind;
  legalName: string;
  corridorId: string;
  side: 'source' | 'destination';
  credentials: Record<string, unknown>;
  seatCount: number;
}

/** A draft case held locally until submitted (§5.2 P1). */
export interface CaseDraft {
  corridorId: string;
  patientId: string;
  intake: Record<string, unknown>;
  savedAt: string;
}

export interface CasesApi {
  listCases(query: ListCasesQuery): Promise<Case[]>;
  getCase(ref: string): Promise<Case | null>;
  listCaseEvents(ref: string): Promise<CaseEvent[]>;
  submitCase(input: SubmitCaseInput): Promise<Case>;
  /** §5.8 ops intervention. Rejects an illegal transition rather than coercing it. */
  changeCaseStatus(ref: string, to: CaseStatus, actorDisplayName: string): Promise<Case>;

  listLedger(providerId: string): Promise<LedgerEntry[]>;
  listAllLedger(): Promise<{ providerId: string; entries: LedgerEntry[] }[]>;

  listMessages(ref: string): Promise<Message[]>;
  sendMessage(ref: string, body: string, authorDisplayName: string): Promise<Message>;

  listNotifications(): Promise<Notification[]>;
  markNotificationRead(id: string): Promise<void>;

  getProvider(id: string): Promise<Provider | null>;
  listProviders(): Promise<Provider[]>;
  listVerificationQueue(): Promise<Provider[]>;
  registerProvider(input: RegisterProviderInput): Promise<Provider>;
  decideVerification(id: string, approve: boolean, reasonKey?: string): Promise<Provider>;

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

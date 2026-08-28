import type { CasesApi } from '../cases';
import { mockCasesApi } from './mock-cases';

/**
 * The case layer's only implementation, for now.
 *
 * Unlike the imaging and scheduling APIs, the case layer has NO backend yet —
 * `apps/api` has no cases, providers, corridors, messaging, or ledger module.
 * So this is not a mock standing in for a real client that exists; it is the
 * contract made runnable so the screens can be built and reviewed against it.
 *
 * When the backend lands, add the live client and select on `isMockMode()`.
 * The screens import `casesApi` and will not need to change.
 */
export const casesApi: CasesApi = mockCasesApi;

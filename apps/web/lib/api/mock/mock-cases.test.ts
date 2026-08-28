import { describe, expect, it } from 'vitest';
import { canTransition, summariseLedger } from '@mir/contracts';
import { mockCasesApi } from './mock-cases';

describe('mock cases api', () => {
  it('lists cases visible to a side, and never cases from another provider', async () => {
    const all = await mockCasesApi.listCases({ providerId: 'prov-source-1' });
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      expect([c.submittedByProviderId, c.matchedProviderId]).toContain('prov-source-1');
    }
  });

  it('filters by status, for the §5.3 provider case list', async () => {
    const completed = await mockCasesApi.listCases({
      providerId: 'prov-source-1',
      status: 'completed',
    });
    expect(completed.length).toBeGreaterThan(0);
    for (const c of completed) {
      expect(c.status).toBe('completed');
    }
  });

  it('finds a case by its reference number, the way a provider searches (§5.3)', async () => {
    const [first] = await mockCasesApi.listCases({ providerId: 'prov-source-1' });
    expect(first).toBeDefined();
    if (first === undefined) return;
    const found = await mockCasesApi.getCase(first.ref);
    expect(found?.ref).toBe(first.ref);
  });

  it('returns null for an unknown reference rather than throwing', async () => {
    expect(await mockCasesApi.getCase('MIR-1999-0001')).toBeNull();
  });

  it('returns a timeline whose transitions are all legal (§5.3)', async () => {
    const events = await mockCasesApi.listCaseEvents('MIR-2026-0417');
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      if (event.from !== null) {
        expect(canTransition(event.from, event.to)).toBe(true);
      }
    }
  });

  it('orders the timeline oldest first, so a history reads downward', async () => {
    const events = await mockCasesApi.listCaseEvents('MIR-2026-0417');
    const times = events.map((e) => Date.parse(e.occurredAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('serves a ledger that summarises into separate fee kinds (§5.7)', async () => {
    const entries = await mockCasesApi.listLedger('prov-source-1');
    const summary = summariseLedger(entries);
    expect(Object.keys(summary.coordinationFees).length).toBeGreaterThan(0);
    expect(Object.keys(summary.subscriptions).length).toBeGreaterThan(0);
  });

  it('scopes messages to one case (§5.6)', async () => {
    const messages = await mockCasesApi.listMessages('MIR-2026-0417');
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message.caseRef).toBe('MIR-2026-0417');
    }
  });

  it('reports the verification state a provider must see for themselves (§5.1)', async () => {
    const pending = await mockCasesApi.getProvider('prov-source-2');
    expect(pending?.verification.status).toBe('pending');
  });

  it('lists the admin approval queue as pending providers only (§5.1, §5.8)', async () => {
    const queue = await mockCasesApi.listVerificationQueue();
    expect(queue.length).toBeGreaterThan(0);
    for (const provider of queue) {
      expect(provider.verification.status).toBe('pending');
    }
  });

  it('serves the ops pipeline across all providers, not one provider list (§5.8)', async () => {
    const all = await mockCasesApi.listAllCases();
    const mine = await mockCasesApi.listCases({ providerId: 'prov-source-1' });
    expect(all.length).toBeGreaterThanOrEqual(mine.length);
  });
});

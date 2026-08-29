'use client';

import type { CurrencyCode, Money } from '@mir/contracts';
import { formatMoney } from '../case/labels';

/**
 * Per-currency totals, rendered side by side — brief §5.7 (multi-currency).
 *
 * Deliberately renders SEVERAL figures and never one. Adding 250 USD to 99 EUR
 * produces a number that is wrong in every currency, so there is no code path
 * here that could produce a combined amount even if a caller asked for one.
 *
 * Shared by the provider ledger and the ops oversight table so the two cannot
 * disagree about how money is presented.
 */
export function CurrencyTotals({
  totals,
  locale,
}: {
  totals: Partial<Record<CurrencyCode, Money>>;
  locale: string;
}): React.JSX.Element {
  const amounts = Object.values(totals).filter((money): money is Money => money !== undefined);
  if (amounts.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 font-semibold">
      {amounts.map((money) => (
        // Isolated: a currency-formatted amount is a mixed-direction run, and
        // an unisolated one reorders inside an Arabic sentence.
        <bdi key={money.currency}>{formatMoney(locale, money)}</bdi>
      ))}
    </span>
  );
}

import type { ReconciledCheckpoint } from "../journals/index.js";
import type { Abacus } from "../statement/index.js";
import { type Chrono, chronoConcat, chronoFilter } from "../values/index.js";

export const BALANCE_EPSILON = 0.005;

// The statement reaches the checkpoint's date but no row on it lands on the
// checkpoint's balance, and its opening doesn't either, so what is new since
// the checkpoint can't be told apart from what is already in the ledger.
export class ReconciliationMatchError extends Error {
  override readonly name = "ReconciliationMatchError";

  constructor(
    message: string,
    readonly checkpoint: { date: string; balance: number },
  ) {
    super(message);
  }
}

// Date filter is the backbone; balance match (when the statement includes
// the reconciled row itself) trims the checkpoint row and anything earlier
// that day so we don't re-import it. `statementOpening` is the opening the
// statement prints; when it equals the checkpoint, the whole checkpoint day
// is new.
export function newTransactionsSinceReconciliation(
  transactions: Chrono<Abacus>,
  checkpoint: ReconciledCheckpoint | null,
  statementOpening: number | null = null,
): Chrono<Abacus> {
  if (!checkpoint) return transactions;
  const afterDate = chronoFilter(transactions, (t) => t.date > checkpoint.date);
  const onDate = chronoFilter(transactions, (t) => t.date === checkpoint.date);
  if (onDate.length === 0) return afterDate;

  const openingMatches =
    statementOpening !== null &&
    Math.abs(statementOpening - checkpoint.balance) < BALANCE_EPSILON;

  let anchor = -1;
  let sawNullBalance = false;
  for (let i = 0; i < onDate.length; i++) {
    const b = onDate[i].balance;
    if (b === null) {
      sawNullBalance = true;
      continue;
    }
    if (Math.abs(b - checkpoint.balance) < BALANCE_EPSILON) anchor = i;
  }

  if (anchor >= 0) return chronoConcat(onDate.slice(anchor + 1), afterDate);
  if (openingMatches) return chronoConcat(onDate, afterDate);

  if (sawNullBalance) {
    throw new ReconciliationMatchError(
      `Statement row on ${checkpoint.date} has no running balance; ` +
        `balance-assertion reconciliation requires per-row balances.`,
      checkpoint,
    );
  }
  throw new ReconciliationMatchError(
    `Statement has ${onDate.length} row(s) on ${checkpoint.date} but none ` +
      `carry the asserted balance ${checkpoint.balance}, and the statement's ` +
      `opening does not match it either.`,
    checkpoint,
  );
}

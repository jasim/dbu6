import type { ReconciledCheckpoint } from "../journals/index.js";
import type { Abacus } from "../statement/index.js";
import {
  type Chrono,
  chronoConcat,
  chronoFilter,
  sameAmount,
} from "../values/index.js";

// The statement reaches the checkpoint's date, but neither the keys posted
// that day, nor a row landing on the checkpoint's balance, nor its opening
// tell what is new since the checkpoint from what is already in the ledger.
export class ReconciliationMatchError extends Error {
  override readonly name = "ReconciliationMatchError";

  constructor(
    message: string,
    readonly checkpoint: { date: string; balance: number },
  ) {
    super(message);
  }
}

// The statement rows the books don't hold yet. Rows before the checkpoint's
// date are in the books and rows after it are new. On the checkpoint's date
// the books hold some of the day, and checkpoint-day.md says how the rest is
// found: by the keys posted that day (`postedKeys`, from
// `loadPostedKeysOn`), and when those can't vouch for the day, by the row
// whose balance lands on the checkpoint. `statementOpening` is the opening
// the statement prints; when it equals the checkpoint and no row lands on it,
// the whole checkpoint day is new.
export function newTransactionsSinceReconciliation(
  transactions: Chrono<Abacus>,
  checkpoint: ReconciledCheckpoint | null,
  statementOpening: number | null = null,
  postedKeys: ReadonlySet<string> | null = null,
): Chrono<Abacus> {
  if (!checkpoint) return transactions;
  const afterDate = chronoFilter(transactions, (t) => t.date > checkpoint.date);
  const onDate = chronoFilter(transactions, (t) => t.date === checkpoint.date);
  if (onDate.length === 0) return afterDate;

  const byKey = newOnDateByKey(
    onDate,
    checkpoint,
    postedKeys,
    transactions[0].date < checkpoint.date,
  );
  if (byKey) return chronoConcat(byKey, afterDate);

  const openingMatches =
    statementOpening !== null &&
    sameAmount(statementOpening, checkpoint.balance);

  let anchor = -1;
  let sawNullBalance = false;
  for (let i = 0; i < onDate.length; i++) {
    const b = onDate[i].balance;
    if (b === null) {
      sawNullBalance = true;
      continue;
    }
    if (sameAmount(b, checkpoint.balance)) anchor = i;
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

// The checkpoint day's new rows, told apart by key: the rows whose keys the
// books hold that day are in, the rest are new. Null when the keys can't
// vouch for the day, and the balance anchor decides instead:
//   - some journal that day has no key (`postedKeys` is null);
//   - the statement starts before the day, so it holds all of it, yet a key
//     posted that day isn't among its rows (the bank reworded or re-dated
//     it);
//   - the day's opening, plus the rows found in the books, doesn't reach the
//     checkpoint's balance.
function newOnDateByKey(
  onDate: Chrono<Abacus>,
  checkpoint: ReconciledCheckpoint,
  postedKeys: ReadonlySet<string> | null,
  holdsWholeDay: boolean,
): Chrono<Abacus> | null {
  const first = onDate[0];
  if (postedKeys === null || first.balance === null) return null;

  const isPosted = (t: Abacus) =>
    t.source_transaction_key != null &&
    postedKeys.has(t.source_transaction_key);
  if (holdsWholeDay) {
    const keys = new Set(onDate.map((t) => t.source_transaction_key));
    for (const key of postedKeys) if (!keys.has(key)) return null;
  }

  let reached = first.balance - first.deposit + first.withdrawal;
  for (const t of onDate) if (isPosted(t)) reached += t.deposit - t.withdrawal;
  if (!sameAmount(reached, checkpoint.balance)) return null;

  return chronoFilter(onDate, (t) => !isPosted(t));
}

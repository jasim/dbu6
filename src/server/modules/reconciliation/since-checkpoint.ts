import type { PostedRow, ReconciledCheckpoint } from "../journals/index.js";
import type { Abacus } from "../statement/index.js";
import {
  type Chrono,
  chronoConcat,
  chronoFilter,
  sameAmount,
} from "../values/index.js";
import { newOnCheckpointDay } from "./checkpoint-day.js";

// The statement reaches the checkpoint's date, but neither pairing it with
// the rows posted that day, nor a row landing on the checkpoint's balance,
// nor its opening tell what is new since the checkpoint from what is already
// in the ledger.
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
// found: by pairing the day's statement rows with the rows posted that day
// (`posted`, from `loadPostedRowsOn`), and when that can't vouch for the day,
// by the row whose balance lands on the checkpoint. `statementOpening` is the
// opening the statement prints; when it equals the checkpoint and no row
// lands on it, the whole checkpoint day is new.
export function newTransactionsSinceReconciliation(
  transactions: Chrono<Abacus>,
  checkpoint: ReconciledCheckpoint | null,
  statementOpening: number | null = null,
  posted: readonly PostedRow[] | null = null,
): Chrono<Abacus> {
  if (!checkpoint) return transactions;
  const afterDate = chronoFilter(transactions, (t) => t.date > checkpoint.date);
  const onDate = chronoFilter(transactions, (t) => t.date === checkpoint.date);
  if (onDate.length === 0) return afterDate;

  const paired =
    posted &&
    newOnCheckpointDay(
      onDate,
      checkpoint,
      posted,
      transactions[0].date < checkpoint.date,
    );
  if (paired) return chronoConcat(paired, afterDate);

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

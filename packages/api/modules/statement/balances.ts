// Ordering and running-balance arithmetic over Abacus rows.
import type { Abacus, BalancedStatement } from "./Abacus.js";
import { type Chrono, chronoMap, unsafeAsChrono } from "../values/index.js";
import {
  BalanceMismatchError,
  SegmentBalanceMismatchError,
} from "./import-errors.js";

// `unordered` is an explicit parser assertion, never something we infer from
// conflicting transitions. It is for sources that group independent sections
// (for example, domestic and international card transactions) instead of
// presenting one ledger sequence.
type DateDirection = "ascending" | "descending";
type ParseOrder = DateDirection | "unordered";

export type DateTransition = {
  fromRow: number;
  toRow: number;
  fromDate: string;
  toDate: string;
  direction: DateDirection | "same-date";
};

export type DateOrderAnalysis = {
  ascendingPairs: number;
  descendingPairs: number;
  sameDatePairs: number;
  transitions: DateTransition[];
  minorityDirection: DateDirection | null;
  conflictingTransitions: DateTransition[];
};

export function analyzeDateOrder(txns: readonly Abacus[]): DateOrderAnalysis {
  let ascendingPairs = 0;
  let descendingPairs = 0;
  let sameDatePairs = 0;
  const transitions: DateTransition[] = [];

  for (let i = 1; i < txns.length; i++) {
    const fromDate = txns[i - 1].date;
    const toDate = txns[i].date;
    const direction =
      fromDate < toDate
        ? "ascending"
        : fromDate > toDate
          ? "descending"
          : "same-date";

    if (direction === "ascending") ascendingPairs++;
    else if (direction === "descending") descendingPairs++;
    else sameDatePairs++;

    transitions.push({
      fromRow: i,
      toRow: i + 1,
      fromDate,
      toDate,
      direction,
    });
  }

  const mixedOrder = ascendingPairs > 0 && descendingPairs > 0;
  const minorityDirection = !mixedOrder
    ? null
    : ascendingPairs < descendingPairs
      ? "ascending"
      : descendingPairs < ascendingPairs
        ? "descending"
        : null;
  const conflictingTransitions = mixedOrder
    ? transitions.filter(
        (transition) =>
          transition.direction !== "same-date" &&
          (minorityDirection === null ||
            transition.direction === minorityDirection),
      )
    : [];

  return {
    ascendingPairs,
    descendingPairs,
    sameDatePairs,
    transitions,
    minorityDirection,
    conflictingTransitions,
  };
}

function deriveOrder(txns: readonly Abacus[]): DateDirection {
  const {
    ascendingPairs,
    descendingPairs,
    minorityDirection,
    conflictingTransitions,
  } = analyzeDateOrder(txns);
  if (ascendingPairs > 0 && descendingPairs > 0) {
    const conflicts = conflictingTransitions
      .map(
        (transition) =>
          `rows ${transition.fromRow}->${transition.toRow}: ${transition.fromDate}->${transition.toDate} (${transition.direction})`,
      )
      .join("; ");
    throw new Error(
      `Cannot determine statement order: source rows are non-monotonic by date (${ascendingPairs} ascending and ${descendingPairs} descending transitions). ${minorityDirection === null ? "Date-changing transitions" : "Minority-direction transition(s)"}: ${conflicts}. Expected the parser to hand over rows in a single direction. Pass an explicit \`order\` to normalizeChronological if the parser already knows.`,
    );
  }
  if (descendingPairs > 0) return "descending";
  return "ascending";
}

export function normalizeChronological(
  txns: readonly Abacus[],
  order?: ParseOrder,
): Chrono<Abacus> {
  const resolvedOrder = order ?? deriveOrder(txns);

  // A descending ledger must be reversed before sorting so same-date rows are
  // also reversed into chronological order. For explicitly unordered input,
  // the source order is the only deterministic tie-break available, so retain
  // it for rows sharing a date. The index tie-break makes that behavior
  // intentional rather than relying implicitly on Array.sort stability.
  const oriented =
    resolvedOrder === "descending" ? [...txns].reverse() : [...txns];
  const chronological = oriented
    .map((transaction, sourceIndex) => ({ transaction, sourceIndex }))
    .sort(
      (a, b) =>
        a.transaction.date.localeCompare(b.transaction.date) ||
        a.sourceIndex - b.sourceIndex,
    )
    .map(({ transaction }) => transaction);
  return chronological as unknown as Chrono<Abacus>;
}

export function normalizeExtractedTransactions(
  transactions: readonly Abacus[],
): Chrono<Abacus> {
  const dateOrder = analyzeDateOrder(transactions);
  const isMixedOrder =
    dateOrder.ascendingPairs > 0 && dateOrder.descendingPairs > 0;

  // Some statements group otherwise ordered transactions into independent
  // sections, such as domestic followed by international card activity. When
  // no row prints a running balance, the ordering between those sections is
  // not financially observable: date-sorting changes neither the transaction
  // total nor closing-balance verification. Preserve source order for same-day
  // ties and explicitly declare the source unordered.
  //
  // A printed balance makes row order significant, however. In that case keep
  // the normal inference path so mixed directions still fail loudly instead
  // of silently attaching balance checkpoints to a potentially wrong order.
  const hasPrintedBalances = transactions.some(
    (transaction) => transaction.balance !== null,
  );
  if (isMixedOrder && !hasPrintedBalances) {
    return normalizeChronological(transactions, "unordered");
  }
  return normalizeChronological(transactions);
}

export const BALANCE_TOLERANCE = 1;

export function synthesizeRunningBalances(
  txns: Chrono<Abacus>,
  opening: number | null,
): Chrono<Abacus> {
  if (txns.length === 0) return txns;

  const firstPrintedIdx = txns.findIndex((t) => t.balance !== null);

  if (firstPrintedIdx === -1) {
    if (opening === null) {
      throw new Error(
        "Opening balance required to synthesize per-row balances. Provide opening_balance in the request, include a recognizable opening balance in the statement text, or ensure a prior reconciliation exists for this base account.",
      );
    }
    let current = opening;
    return chronoMap(txns, (t) => {
      current += t.deposit - t.withdrawal;
      return { ...t, balance: current };
    });
  }

  const filled: Abacus[] = txns.map((t) => ({ ...t }));

  for (let i = firstPrintedIdx - 1; i >= 0; i--) {
    const next = filled[i + 1];
    filled[i].balance = next.balance! - next.deposit + next.withdrawal;
  }

  let current = filled[firstPrintedIdx].balance!;
  let lastAnchor = { date: filled[firstPrintedIdx].date, balance: current };
  for (let i = firstPrintedIdx + 1; i < filled.length; i++) {
    const r = filled[i];
    const walked = current + r.deposit - r.withdrawal;
    const printed = txns[i].balance;
    if (printed !== null) {
      if (Math.abs(walked - printed) > BALANCE_TOLERANCE) {
        throw new SegmentBalanceMismatchError(
          lastAnchor,
          { date: r.date },
          walked,
          printed,
          BALANCE_TOLERANCE,
        );
      }
      current = printed;
      lastAnchor = { date: r.date, balance: printed };
    } else {
      current = walked;
    }
    filled[i].balance = current;
  }

  return unsafeAsChrono(filled);
}

export function verifyClosingBalance(
  txns: Chrono<Abacus>,
  closing: number | null,
  hint: string | null = null,
): void {
  if (closing === null || txns.length === 0) return;
  const final = txns[txns.length - 1].balance;
  if (final === null) return;
  if (Math.abs(final - closing) > BALANCE_TOLERANCE) {
    throw new BalanceMismatchError(final, closing, BALANCE_TOLERANCE, hint);
  }
}

// A statement that states both balances must lead from one to the other: the
// opening plus every row reaches the closing. The import still walks any
// balances the rows print against the closing, so together the rows are
// checked against both, whether or not they print balances.
export function verifyDeclaredBalances(statement: BalancedStatement): void {
  const reached = statement.transactions.reduce(
    (balance, row) => balance + row.deposit - row.withdrawal,
    statement.opening,
  );
  if (Math.abs(reached - statement.closing) > BALANCE_TOLERANCE) {
    throw new BalanceMismatchError(
      reached,
      statement.closing,
      BALANCE_TOLERANCE,
    );
  }
}

export function computeRunningBalances(
  txns: Chrono<Abacus>,
  opening: number | null,
  closing: number | null,
): Chrono<Abacus> {
  const noPrintedBalances = txns.every((t) => t.balance === null);
  if (noPrintedBalances && closing === null) {
    throw new Error(
      "Cannot verify statement integrity: statement has no per-row balances and no closing balance. Need one or the other to confirm the parse is correct.",
    );
  }
  const filled = synthesizeRunningBalances(txns, opening);
  const hint = noPrintedBalances
    ? "Did the uploaded statements cover every day from the last reconciled transaction onwards, with no gaps? Any missing period — between the last reconciled date and the earliest uploaded statement, or between two uploaded statements — makes the running balance drift from the statement's printed closing. Re-uploading statements that overlap with what's already in the system is fine; duplicate transactions are detected and skipped."
    : null;
  verifyClosingBalance(filled, closing, hint);
  return filled;
}

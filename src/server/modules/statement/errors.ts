// Why a statement can't be taken as it is: its rows don't reach its balances,
// its parts don't join, or it has no balance to check against. Each error
// carries the statement's facts; app/import-error-response.ts turns them into
// the wire body, with any advice. A `name` literal on each class tells them
// apart.

// The rows, from the balance they start at, end away from the statement's
// closing by more than the per-row rounding tolerance. `suspectedGap` when
// the statement prints no running balances, so a missing period is the
// likely cause rather than a misread row.
export class BalanceMismatchError extends Error {
  override readonly name = "BalanceMismatchError";
  readonly difference: number;

  constructor(
    readonly computedFinal: number,
    readonly statementClosing: number,
    readonly tolerance: number,
    readonly suspectedGap = false,
  ) {
    const difference = Math.abs(computedFinal - statementClosing);
    super(
      `Final calculated balance (${computedFinal}) does not match closing balance from statement (${statementClosing}). Difference: ${difference}, tolerance: ${tolerance}`,
    );
    this.difference = difference;
  }
}

// The statement prints no per-row balances, and neither the statement nor
// the reconciliation checkpoint gives an opening to walk them from.
export class OpeningBalanceUnavailable extends Error {
  override readonly name = "OpeningBalanceUnavailable";

  constructor() {
    super(
      "Opening balance required: statement has no per-row balances and no opening balance was available from the statement or reconciliation checkpoint.",
    );
  }
}

export class ClosingBalanceUnavailable extends Error {
  override readonly name = "ClosingBalanceUnavailable";

  constructor() {
    super(
      "Closing balance required: this credit-card statement reports no closing balance and its final transaction has no printed running balance, so the import cannot be checked against the statement.",
    );
  }
}

// Two uploaded statement parts should meet but their balances do not: the
// earlier part ends at one balance and the later part starts at another.
// `difference` is signed (later start minus earlier end), which is the net of
// whatever activity is missing between them. `reason` is
// `same-statement-twice` when the later part covers the same dates and
// balances as the earlier one.
export class StatementBoundaryMismatchError extends Error {
  override readonly name = "StatementBoundaryMismatchError";
  readonly difference: number;

  constructor(
    readonly earlierClosing: number,
    readonly laterOpening: number,
    readonly earlierSource: string,
    readonly laterSource: string,
    readonly reason: "gap" | "same-statement-twice" = "gap",
  ) {
    const difference = round2(laterOpening - earlierClosing);
    super(
      `Statement boundary mismatch: ${earlierSource} ends at ${earlierClosing}, but ${laterSource} starts at ${laterOpening}. The activity between them nets to ${difference}.`,
    );
    this.difference = difference;
  }
}

// Two uploaded statement parts both cover a day and print it differently, so
// neither copy can be trusted over the other. Names the parts, the day, and
// the first row on that day that differs.
export class StatementDisagreementError extends Error {
  override readonly name = "StatementDisagreementError";

  constructor(
    readonly parts: readonly [string, string],
    readonly date: string,
    readonly row: DisagreeingRow,
  ) {
    super(
      `Statement parts disagree about ${date}: ${parts[0]} and ${parts[1]} both cover that day but print it differently, starting at ${describeRow(row)}.`,
    );
  }
}

export type DisagreeingRow = {
  part: string;
  narration: string;
  withdrawal: number;
  deposit: number;
  balance: number | null;
};

function describeRow(row: DisagreeingRow): string {
  const amount =
    row.deposit > 0 ? `deposit ${row.deposit}` : `withdrawal ${row.withdrawal}`;
  const balance = row.balance === null ? "" : `, balance ${row.balance}`;
  return `${JSON.stringify(row.narration)} (${amount}${balance}) in ${row.part}`;
}

// A multi-part upload holds a part with no balance anchor at all: no opening,
// no closing, and no row that prints a running balance. Such a part cannot
// say where it belongs among the others.
export class StatementPartUnjoinableError extends Error {
  override readonly name = "StatementPartUnjoinableError";

  constructor(readonly part: string) {
    super(
      `Statement part ${part} prints no opening balance, no closing balance and no running balances, so it cannot be placed among the other uploaded parts.`,
    );
  }
}

// A part of a multi-part upload contradicts itself: its declared opening or
// closing does not match its own rows, or its printed running balances do not
// chain. `cause` is the balance error the check reused, when it reused one.
export class StatementPartInvalidError extends Error {
  override readonly name = "StatementPartInvalidError";

  constructor(
    readonly part: string,
    readonly detail: string,
    override readonly cause?:
      BalanceMismatchError | SegmentBalanceMismatchError,
  ) {
    super(`Statement part ${part} is not self-consistent: ${detail}`, {
      cause,
    });
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// The statement prints per-row balances on some rows, but the activity
// between two adjacent printed balances does not reconcile.
export class SegmentBalanceMismatchError extends Error {
  override readonly name = "SegmentBalanceMismatchError";
  readonly fromDate: string;
  readonly toDate: string;
  readonly fromBalance: number;
  readonly difference: number;

  constructor(
    from: { date: string; balance: number },
    to: { date: string },
    readonly walked: number,
    readonly printed: number,
    readonly tolerance: number,
  ) {
    const difference = Math.abs(walked - printed);
    super(
      `Running balance drift inside the statement: starting from the printed balance ${from.balance} on ${from.date} and walking forward to ${to.date}, the activity yields ${walked} but that row prints ${printed} (difference ${difference}, tolerance ${tolerance}).`,
    );
    this.fromDate = from.date;
    this.toDate = to.date;
    this.fromBalance = from.balance;
    this.difference = difference;
  }
}

// A document fails to parse as Abacus JSON.
export class AbacusJsonParseError extends Error {
  override readonly name = "AbacusJsonParseError";

  constructor(readonly detail: string) {
    super(`Abacus JSON parse failed: ${detail}`);
  }
}

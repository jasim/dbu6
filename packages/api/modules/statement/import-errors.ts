import type { StatementImportError } from "dbu6-shared";

// Errors that the import pipeline wants to surface to API callers as a
// structured JSON body with a specific HTTP status. Each subclass builds its
// variant of `statementImportErrorSchema` (dbu6-shared) in `toPayload()` — the
// HTTP handler just dispatches, it does not re-derive the payload.
export abstract class ApiImportError extends Error {
  abstract readonly status: number;
  abstract toPayload(): StatementImportError;
}

export class ReconciliationMatchError extends ApiImportError {
  readonly status = 422;

  constructor(
    message: string,
    readonly checkpoint: { date: string; balance: number },
  ) {
    super(message);
    this.name = "ReconciliationMatchError";
  }

  toPayload(): StatementImportError {
    return {
      error: "reconciliation_match_failed",
      message: this.message,
      checkpoint_date: this.checkpoint.date,
      checkpoint_balance: this.checkpoint.balance,
    };
  }
}

// Thrown when a statement's computed closing balance drifts further than the
// per-row rounding tolerance from the closing it reports. Surfaced as 422 —
// this is a data-consistency signal, not a server fault. `hint` is given when
// a missing period is the likely cause (the statement prints no running
// balances), and says so in words; the payload's `suspected_gap` records it.
export class BalanceMismatchError extends ApiImportError {
  readonly status = 422;
  readonly computedFinal: number;
  readonly statementClosing: number;
  readonly tolerance: number;
  readonly difference: number;
  readonly hint: string | null;

  constructor(
    computedFinal: number,
    statementClosing: number,
    tolerance: number,
    hint: string | null = null,
  ) {
    const difference = Math.abs(computedFinal - statementClosing);
    super(
      `Final calculated balance (${computedFinal}) does not match closing balance from statement (${statementClosing}). Difference: ${difference}, tolerance: ${tolerance}`,
    );
    this.name = "BalanceMismatchError";
    this.computedFinal = computedFinal;
    this.statementClosing = statementClosing;
    this.tolerance = tolerance;
    this.difference = difference;
    this.hint = hint;
  }

  toPayload(): StatementImportError {
    return {
      error: "balance_mismatch",
      message: this.message,
      computed_final: this.computedFinal,
      statement_closing: this.statementClosing,
      difference: this.difference,
      tolerance: this.tolerance,
      suspected_gap: this.hint !== null,
      ...(this.hint !== null ? { hint: this.hint } : {}),
    };
  }
}

// Thrown when the statement has no per-row balances AND no opening balance
// is available from any source (the statement's opening, reconciliation
// checkpoint). Surfaced as 400 — the caller needs to set up a balance
// assertion first, or supply a statement whose rows print balances. Beats
// the alternative of silently accepting a user-typed number that might
// conflict with a later reconciliation.
export class OpeningBalanceUnavailable extends ApiImportError {
  readonly status = 400;

  constructor() {
    super(
      "Opening balance required: statement has no per-row balances and no opening balance was available from the statement or reconciliation checkpoint. Add a balance assertion for this account before importing.",
    );
    this.name = "OpeningBalanceUnavailable";
  }

  toPayload(): StatementImportError {
    return {
      error: "opening_balance_unavailable",
      message: this.message,
    };
  }
}

export class ClosingBalanceUnavailable extends ApiImportError {
  readonly status = 400;

  constructor() {
    super(
      "Closing balance required: this credit-card statement reports no closing balance and its final transaction has no printed running balance, so the import cannot be checked against the statement.",
    );
    this.name = "ClosingBalanceUnavailable";
  }

  toPayload(): StatementImportError {
    return {
      error: "closing_balance_unavailable",
      message: this.message,
    };
  }
}

// Thrown when two uploaded statement parts should meet but their balances do
// not: the earlier part ends at one balance and the later part starts at
// another. `difference` is signed (later start minus earlier end), which is
// the net of whatever activity is missing between them. `reason` is
// `same-statement-twice` when the later part covers the same dates and
// balances as the earlier one, and `hint` then says so in words.
export class StatementBoundaryMismatchError extends ApiImportError {
  readonly status = 422;
  readonly earlierClosing: number;
  readonly laterOpening: number;
  readonly earlierSource: string;
  readonly laterSource: string;
  readonly difference: number;
  readonly reason: "gap" | "same-statement-twice";
  readonly hint: string | null;

  constructor(
    earlierClosing: number,
    laterOpening: number,
    earlierSource: string,
    laterSource: string,
    reason: "gap" | "same-statement-twice" = "gap",
  ) {
    const difference = round2(laterOpening - earlierClosing);
    const hint =
      reason === "same-statement-twice"
        ? `${laterSource} covers the same dates as ${earlierSource} and starts and ends at the same balances: it is almost certainly the same statement uploaded twice.`
        : null;
    super(
      `Statement boundary mismatch: ${earlierSource} ends at ${earlierClosing}, but ${laterSource} starts at ${laterOpening}. The activity between them nets to ${difference}.` +
        (hint === null ? "" : ` ${hint}`),
    );
    this.name = "StatementBoundaryMismatchError";
    this.earlierClosing = earlierClosing;
    this.laterOpening = laterOpening;
    this.earlierSource = earlierSource;
    this.laterSource = laterSource;
    this.difference = difference;
    this.reason = reason;
    this.hint = hint;
  }

  toPayload(): StatementImportError {
    return {
      error: "statement_boundary_mismatch",
      message: this.message,
      reason: this.reason,
      earlier_source: this.earlierSource,
      later_source: this.laterSource,
      earlier_closing: this.earlierClosing,
      later_opening: this.laterOpening,
      difference: this.difference,
      ...(this.hint !== null ? { hint: this.hint } : {}),
    };
  }
}

// Thrown when two uploaded statement parts both cover a day and print it
// differently, so neither copy can be trusted over the other. Names the
// parts, the day, and the first row on that day that differs.
export class StatementDisagreementError extends ApiImportError {
  readonly status = 422;
  readonly parts: readonly [string, string];
  readonly date: string;
  readonly row: DisagreeingRow;

  constructor(
    parts: readonly [string, string],
    date: string,
    row: DisagreeingRow,
  ) {
    super(
      `Statement parts disagree about ${date}: ${parts[0]} and ${parts[1]} both cover that day but print it differently, starting at ${describeRow(row)}. Re-export the statements so that no day is covered twice, or combine them into one file.`,
    );
    this.name = "StatementDisagreementError";
    this.parts = parts;
    this.date = date;
    this.row = row;
  }

  toPayload(): StatementImportError {
    return {
      error: "statement_disagreement",
      message: this.message,
      parts: [...this.parts],
      date: this.date,
      row: { ...this.row },
    };
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

// Thrown when a multi-part upload holds a part with no balance anchor at
// all: no opening, no closing, and no row that prints a running balance.
// Such a part cannot say where it belongs among the others.
export class StatementPartUnjoinableError extends ApiImportError {
  readonly status = 422;
  readonly part: string;

  constructor(part: string) {
    super(
      `Statement part ${part} prints no opening balance, no closing balance and no running balances, so it cannot be placed among the other uploaded parts. Import it on its own (an opening balance override or the reconciliation checkpoint then supplies its opening), or combine the pages into one file.`,
    );
    this.name = "StatementPartUnjoinableError";
    this.part = part;
  }

  toPayload(): StatementImportError {
    return {
      error: "statement_part_unjoinable",
      message: this.message,
      part: this.part,
    };
  }
}

// Thrown when a part of a multi-part upload contradicts itself: its declared
// opening or closing does not match its own rows, or its printed running
// balances do not chain. `cause` is the underlying balance error when the
// check reused one.
export class StatementPartInvalidError extends ApiImportError {
  readonly status = 422;
  readonly part: string;
  readonly detail: string;
  readonly cause: ApiImportError | null;

  constructor(
    part: string,
    detail: string,
    cause: ApiImportError | null = null,
  ) {
    super(`Statement part ${part} is not self-consistent: ${detail}`);
    this.name = "StatementPartInvalidError";
    this.part = part;
    this.detail = detail;
    this.cause = cause;
  }

  toPayload(): StatementImportError {
    return {
      error: "statement_part_invalid",
      message: this.message,
      part: this.part,
      detail: this.detail,
      ...(this.cause !== null ? { cause: this.cause.toPayload() } : {}),
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export class AmbiguousDuplicateError extends ApiImportError {
  readonly status = 422;

  constructor(
    readonly sourceKey: string | null,
    readonly candidateIds: Array<number | string>,
  ) {
    super(
      `Transaction matches multiple existing candidates (${candidateIds.join(", ")}); refusing to choose one automatically.`,
    );
    this.name = "AmbiguousDuplicateError";
  }

  toPayload(): StatementImportError {
    return {
      error: "ambiguous_duplicate",
      message: this.message,
      source_transaction_key: this.sourceKey,
      candidate_ids: this.candidateIds,
    };
  }
}

export class AssertionConflictError extends ApiImportError {
  readonly status = 422;

  constructor(
    readonly date: string,
    readonly existing: number,
    readonly expected: number,
  ) {
    super(
      `Balance assertion conflict on ${date}: existing assertion ${existing} does not match validated statement close ${expected}.`,
    );
    this.name = "AssertionConflictError";
  }

  toPayload(): StatementImportError {
    return {
      error: "assertion_conflict",
      message: this.message,
      date: this.date,
      existing_assertion: this.existing,
      expected_assertion: this.expected,
    };
  }
}

// Thrown when a statement prints per-row balances on some rows but the
// activity between two adjacent printed balances does not reconcile.
export class SegmentBalanceMismatchError extends ApiImportError {
  readonly status = 422;
  readonly fromDate: string;
  readonly toDate: string;
  readonly fromBalance: number;
  readonly walked: number;
  readonly printed: number;
  readonly tolerance: number;
  readonly difference: number;

  constructor(
    from: { date: string; balance: number },
    to: { date: string },
    walked: number,
    printed: number,
    tolerance: number,
  ) {
    const difference = Math.abs(walked - printed);
    super(
      `Running balance drift inside the statement: starting from the printed balance ${from.balance} on ${from.date} and walking forward to ${to.date}, the activity yields ${walked} but that row prints ${printed} (difference ${difference}, tolerance ${tolerance}). A transaction between these two rows was likely mis-parsed.`,
    );
    this.name = "SegmentBalanceMismatchError";
    this.fromDate = from.date;
    this.toDate = to.date;
    this.fromBalance = from.balance;
    this.walked = walked;
    this.printed = printed;
    this.tolerance = tolerance;
    this.difference = difference;
  }

  toPayload(): StatementImportError {
    return {
      error: "segment_balance_mismatch",
      message: this.message,
      from_date: this.fromDate,
      to_date: this.toDate,
      from_balance: this.fromBalance,
      walked: this.walked,
      printed: this.printed,
      difference: this.difference,
      tolerance: this.tolerance,
    };
  }
}

// Thrown when a document fails to parse as Abacus JSON.
export class AbacusJsonParseError extends ApiImportError {
  readonly status = 400;
  readonly detail: string;

  constructor(detail: string) {
    super(`Abacus JSON parse failed: ${detail}`);
    this.name = "AbacusJsonParseError";
    this.detail = detail;
  }

  toPayload(): StatementImportError {
    return {
      error: "abacus_json_parse_failed",
      message: "Could not parse the uploaded JSON as abacus rows.",
      detail: this.detail,
    };
  }
}

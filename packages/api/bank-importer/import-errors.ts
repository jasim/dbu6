// Errors that the import pipeline wants to surface to API callers as a
// structured JSON body with a specific HTTP status. Each subclass owns its
// own wire shape via `toPayload()` — the HTTP handler just dispatches, it
// does not re-derive the payload.
export abstract class ApiImportError extends Error {
  abstract readonly status: number;
  abstract toPayload(): Record<string, unknown>;
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

  toPayload() {
    return {
      error: "reconciliation_match_failed",
      message: this.message,
      checkpoint_date: this.checkpoint.date,
      checkpoint_balance: this.checkpoint.balance,
    };
  }
}

// Thrown when a freeform statement's computed closing balance drifts
// further than the per-row rounding tolerance from the LLM-extracted
// closing. Surfaced as 422 — this is a data-consistency signal, not a
// server fault.
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

  toPayload() {
    return {
      error: "balance_mismatch",
      message: this.message,
      computed_final: this.computedFinal,
      statement_closing: this.statementClosing,
      difference: this.difference,
      tolerance: this.tolerance,
      ...(this.hint !== null ? { hint: this.hint } : {}),
    };
  }
}

// Thrown when the statement has no per-row balances AND no opening balance
// is available from any source (LLM-extracted opening, reconciliation
// checkpoint). Surfaced as 400 — the caller needs to set up a balance
// assertion first, or supply a statement whose rows print balances. Beats
// the alternative of silently accepting a user-typed number that might
// conflict with a later reconciliation.
export class OpeningBalanceUnavailable extends ApiImportError {
  readonly status = 400;

  constructor() {
    super(
      "Opening balance required: statement has no per-row balances and no opening balance was available from the statement text or reconciliation checkpoint. Add a balance assertion for this account before importing.",
    );
    this.name = "OpeningBalanceUnavailable";
  }

  toPayload() {
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
      "Closing balance required: this credit-card statement has no usable extracted closing balance and its final transaction has no printed running balance. Enter the statement's printed closing amount and retry.",
    );
    this.name = "ClosingBalanceUnavailable";
  }

  toPayload() {
    return {
      error: "closing_balance_unavailable",
      message: this.message,
      field: "manual_closing_balance",
    };
  }
}

export class StatementBoundaryMismatchError extends ApiImportError {
  readonly status = 422;
  readonly earlierClosing: number;
  readonly laterOpening: number;
  readonly earlierSource: string;
  readonly laterSource: string;
  readonly difference: number;

  constructor(
    earlierClosing: number,
    laterOpening: number,
    earlierSource: string,
    laterSource: string,
  ) {
    const difference = Math.abs(earlierClosing - laterOpening);
    super(
      `Statement boundary mismatch: ${earlierSource} closes at ${earlierClosing}, but ${laterSource} opens at ${laterOpening}. Difference: ${difference}.`,
    );
    this.name = "StatementBoundaryMismatchError";
    this.earlierClosing = earlierClosing;
    this.laterOpening = laterOpening;
    this.earlierSource = earlierSource;
    this.laterSource = laterSource;
    this.difference = difference;
  }

  toPayload() {
    return {
      error: "statement_boundary_mismatch",
      message: this.message,
      earlier_source: this.earlierSource,
      later_source: this.laterSource,
      earlier_closing: this.earlierClosing,
      later_opening: this.laterOpening,
      difference: this.difference,
    };
  }
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

  toPayload() {
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

  toPayload() {
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

  toPayload() {
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

// Thrown when the external PDF-to-CSV extractor fails or produces nothing
// usable — the user gave us a PDF but we couldn't turn it into the text
// form the freeform LLM pipeline expects. Surfaced as 422: the request was
// well-formed, the server could reach its tools, but the input didn't
// match any known table layout.
export class PdfExtractionFailed extends ApiImportError {
  readonly status = 422;
  readonly detail: string;

  constructor(detail: string) {
    super(`PDF extraction failed: ${detail}`);
    this.name = "PdfExtractionFailed";
    this.detail = detail;
  }

  toPayload() {
    return {
      error: "pdf_extraction_failed",
      message: "Could not extract tables from the uploaded PDF(s).",
      detail: this.detail,
    };
  }
}

// Thrown when a multi-file import has parts whose date ranges overlap.
export class OverlappingStatementsError extends ApiImportError {
  readonly status = 400;
  readonly earlierMaxDate: string;
  readonly laterMinDate: string;

  constructor(earlierMaxDate: string, laterMinDate: string) {
    super(
      `Overlapping statement parts: one part ends ${earlierMaxDate} and another starts ${laterMinDate}. Cannot merge ambiguously — upload non-overlapping files, or combine them into one.`,
    );
    this.name = "OverlappingStatementsError";
    this.earlierMaxDate = earlierMaxDate;
    this.laterMinDate = laterMinDate;
  }

  toPayload() {
    return {
      error: "overlapping_statements",
      message: this.message,
      earlier_max_date: this.earlierMaxDate,
      later_min_date: this.laterMinDate,
    };
  }
}

// Thrown when an uploaded JSON file fails to parse as Abacus JSON.
export class AbacusJsonParseError extends ApiImportError {
  readonly status = 400;
  readonly detail: string;

  constructor(detail: string) {
    super(`Abacus JSON parse failed: ${detail}`);
    this.name = "AbacusJsonParseError";
    this.detail = detail;
  }

  toPayload() {
    return {
      error: "abacus_json_parse_failed",
      message: "Could not parse the uploaded JSON as abacus rows.",
      detail: this.detail,
    };
  }
}

// Thrown when the upstream Nua/LLM call fails (network error, gateway 5xx,
// malformed response). Surfaced as 502 — the server itself is fine, but an
// upstream dependency we rely on isn't.
export class LLMExtractionError extends ApiImportError {
  readonly status = 502;
  readonly phase: "transactions" | "balances";
  readonly detail: string;

  constructor(phase: "transactions" | "balances", detail: string) {
    super(`Freeform ${phase} extraction failed: ${detail}`);
    this.name = "LLMExtractionError";
    this.phase = phase;
    this.detail = detail;
  }

  toPayload() {
    return {
      error: "llm_extraction_failed",
      phase: this.phase,
      message: `Freeform ${this.phase} extraction failed`,
      detail: this.detail,
    };
  }
}

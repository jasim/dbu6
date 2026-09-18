import type { StatementImportError } from "dbu6-shared";
import type { CategorizationConfigError } from "../modules/categorization/index.js";
import type {
  BalanceMismatchError,
  SegmentBalanceMismatchError,
} from "../modules/statement/index.js";
import {
  isImportRefusal,
  type ImportRefusal,
} from "../workflows/statement-import/index.js";

/*
 * The one place an import's refusal becomes HTTP: its status, and its
 * variant of `statementImportErrorSchema` (dbu6-shared). The modules' errors
 * carry the facts; the advice in a body's `hint` is written here.
 */

type ImportErrorResponse =
  | { status: 400; body: StatementImportError }
  | { status: 422; body: StatementImportError };

type ImportRouteResponse<T> = { status: 200; body: T } | ImportErrorResponse;

// A refusal as its status and body.
export function importErrorResponse(err: ImportRefusal): ImportErrorResponse {
  switch (err.name) {
    case "AbacusJsonParseError":
      return {
        status: 400,
        body: {
          error: "abacus_json_parse_failed",
          message: "Could not parse the uploaded JSON as abacus rows.",
          detail: err.detail,
        },
      };
    case "OpeningBalanceUnavailable":
      return {
        status: 400,
        body: { error: "opening_balance_unavailable", message: err.message },
      };
    case "ClosingBalanceUnavailable":
      return {
        status: 400,
        body: { error: "closing_balance_unavailable", message: err.message },
      };
    case "CategorizationConfigError":
      return categorizationErrorResponse(err);
    case "BalanceMismatchError":
    case "SegmentBalanceMismatchError":
      return { status: 422, body: balanceErrorBody(err) };
    case "StatementBoundaryMismatchError":
      return {
        status: 422,
        body: {
          error: "statement_boundary_mismatch",
          message: err.message,
          reason: err.reason,
          earlier_source: err.earlierSource,
          later_source: err.laterSource,
          earlier_closing: err.earlierClosing,
          later_opening: err.laterOpening,
          difference: err.difference,
          ...(err.reason === "same-statement-twice"
            ? {
                hint: `${err.laterSource} covers the same dates as ${err.earlierSource} and starts and ends at the same balances: it is almost certainly the same statement uploaded twice.`,
              }
            : {}),
        },
      };
    case "StatementDisagreementError":
      return {
        status: 422,
        body: {
          error: "statement_disagreement",
          message: err.message,
          parts: [...err.parts],
          date: err.date,
          row: { ...err.row },
        },
      };
    case "StatementPartUnjoinableError":
      return {
        status: 422,
        body: {
          error: "statement_part_unjoinable",
          message: err.message,
          part: err.part,
        },
      };
    case "StatementPartInvalidError":
      return {
        status: 422,
        body: {
          error: "statement_part_invalid",
          message: err.message,
          part: err.part,
          detail: err.detail,
          ...(err.cause !== undefined
            ? { cause: balanceErrorBody(err.cause) }
            : {}),
        },
      };
    case "ReconciliationMatchError":
      return {
        status: 422,
        body: {
          error: "reconciliation_match_failed",
          message: err.message,
          checkpoint_date: err.checkpoint.date,
          checkpoint_balance: err.checkpoint.balance,
        },
      };
    case "AmbiguousDuplicateError":
      return {
        status: 422,
        body: {
          error: "ambiguous_duplicate",
          message: err.message,
          source_transaction_key: err.sourceKey,
          candidate_ids: err.candidateIds,
        },
      };
    case "AssertionConflictError":
      return {
        status: 422,
        body: {
          error: "assertion_conflict",
          message: err.message,
          date: err.date,
          existing_assertion: err.existing,
          expected_assertion: err.expected,
        },
      };
  }
}

// Categorization's refusal alone, for the classify routes, whose contract
// declares no other.
export function categorizationErrorResponse(err: CategorizationConfigError): {
  status: 400;
  body: StatementImportError;
} {
  return {
    status: 400,
    body: { error: "categorization_config_error", message: err.message },
  };
}

// The body of a balance check that failed, on its own or as the cause of an
// invalid statement part.
function balanceErrorBody(
  err: BalanceMismatchError | SegmentBalanceMismatchError,
): StatementImportError {
  switch (err.name) {
    case "BalanceMismatchError":
      return {
        error: "balance_mismatch",
        message: err.message,
        computed_final: err.computedFinal,
        statement_closing: err.statementClosing,
        difference: err.difference,
        tolerance: err.tolerance,
        suspected_gap: err.suspectedGap,
        ...(err.suspectedGap
          ? {
              hint: "Did the uploaded statements cover every day from the statement opening through its closing, with no gaps? Missing activity makes the calculated balance drift from the statement's printed closing.",
            }
          : {}),
      };
    case "SegmentBalanceMismatchError":
      return {
        error: "segment_balance_mismatch",
        message: err.message,
        from_date: err.fromDate,
        to_date: err.toDate,
        from_balance: err.fromBalance,
        walked: err.walked,
        printed: err.printed,
        difference: err.difference,
        tolerance: err.tolerance,
      };
  }
}

// An import as a route response: its result on success, and its refusal's
// status and body on failure. Anything else is a server fault and propagates.
export async function respondWithImportErrors<T>(
  run: () => Promise<T>,
): Promise<ImportRouteResponse<T>> {
  try {
    return { status: 200, body: await run() };
  } catch (err) {
    if (!isImportRefusal(err)) throw err;
    return importErrorResponse(err);
  }
}

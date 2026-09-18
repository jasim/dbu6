import { CategorizationConfigError } from "../../modules/categorization/index.js";
import { AssertionConflictError } from "../../modules/drafts/index.js";
import {
  AmbiguousDuplicateError,
  ReconciliationMatchError,
} from "../../modules/reconciliation/index.js";
import {
  AbacusJsonParseError,
  BalanceMismatchError,
  ClosingBalanceUnavailable,
  OpeningBalanceUnavailable,
  SegmentBalanceMismatchError,
  StatementBoundaryMismatchError,
  StatementDisagreementError,
  StatementPartInvalidError,
  StatementPartUnjoinableError,
} from "../../modules/statement/index.js";

// Every way a statement import refuses: the errors its modules raise when the
// statement, the ledger or the user's config won't let it go ahead. Any other
// error is a fault. Each module owns its errors; this list says which of them
// end an import.
const IMPORT_REFUSALS = [
  AbacusJsonParseError,
  BalanceMismatchError,
  SegmentBalanceMismatchError,
  OpeningBalanceUnavailable,
  ClosingBalanceUnavailable,
  StatementBoundaryMismatchError,
  StatementDisagreementError,
  StatementPartUnjoinableError,
  StatementPartInvalidError,
  ReconciliationMatchError,
  AmbiguousDuplicateError,
  AssertionConflictError,
  CategorizationConfigError,
] as const;

export type ImportRefusal = InstanceType<(typeof IMPORT_REFUSALS)[number]>;

export function isImportRefusal(error: unknown): error is ImportRefusal {
  return IMPORT_REFUSALS.some((refusal) => error instanceof refusal);
}

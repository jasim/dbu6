// The reconciliation module: matching statement rows against stored drafts
// and journals, the draft balance-check rule and the running balance behind
// it, and the filter that keeps only what is new since the last checkpoint.
// Import from here rather than from the files.
export {
  assertionFailsSql,
  dayClosings,
  draftOrderBy,
  draftOrderSql,
} from "./balance-check.js";
export {
  duplicateDraftRowsSql,
  duplicateJournalEntryRowsSql,
  findDuplicateDiagnostics,
  type DuplicateDiagnostic,
  type DuplicateDraftSourceRow,
  type DuplicateJournalEntrySourceRow,
} from "./duplicate-diagnostics.js";
export { AmbiguousDuplicateError, findDuplicate } from "./duplicate-store.js";
export {
  baseAccountRunningBalanceCtes,
  failingDraftAssertionsSelect,
} from "./running-balance.js";
export {
  newTransactionsSinceReconciliation,
  ReconciliationMatchError,
} from "./since-checkpoint.js";

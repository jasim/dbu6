// The statement module: the Abacus type, its wire schema, every
// transformation over it, and the errors a statement import raises. Import
// from here rather than from the files.
export {
  abacusStatementFromJson,
  describeStatement,
  parseAbacusJson,
  type Abacus,
  type AbacusStatement,
  type BalancedStatement,
} from "./Abacus.js";
export {
  BALANCE_TOLERANCE,
  analyzeDateOrder,
  computeRunningBalances,
  normalizeChronological,
  normalizeExtractedTransactions,
  synthesizeRunningBalances,
  verifyClosingBalance,
  verifyDeclaredBalances,
  type DateOrderAnalysis,
  type DateTransition,
} from "./balances.js";
export {
  ANCHOR_EPSILON,
  assembleStatements,
  partEdges,
  validatePart,
  type PartEdges,
} from "./assemble.js";
export {
  AbacusJsonParseError,
  AmbiguousDuplicateError,
  ApiImportError,
  AssertionConflictError,
  BalanceMismatchError,
  ClosingBalanceUnavailable,
  OpeningBalanceUnavailable,
  ReconciliationMatchError,
  SegmentBalanceMismatchError,
  StatementBoundaryMismatchError,
  StatementDisagreementError,
  StatementPartInvalidError,
  StatementPartUnjoinableError,
  type DisagreeingRow,
} from "./import-errors.js";

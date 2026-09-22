// The statement module: the Abacus type, its wire schema, every
// transformation over it, and the statement's own errors. Import from here
// rather than from the files.
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
  normalizeChronological,
  synthesizeRunningBalances,
  verifyClosingBalance,
  verifyDeclaredBalances,
} from "./balances.js";
export {
  assembleStatements,
  partEdges,
  validatePart,
  type PartEdges,
} from "./assemble.js";
export {
  AbacusJsonParseError,
  BalanceMismatchError,
  ClosingBalanceUnavailable,
  OpeningBalanceUnavailable,
  SegmentBalanceMismatchError,
  StatementBoundaryMismatchError,
  StatementDisagreementError,
  StatementPartInvalidError,
  StatementPartUnjoinableError,
  type DisagreeingRow,
} from "./errors.js";

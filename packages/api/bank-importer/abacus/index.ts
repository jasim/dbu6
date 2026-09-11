// The Abacus statement module: one type, one wire schema, and every
// transformation over it. Import from here rather than from the files.
export {
  abacusSchema,
  abacusJsonSchema,
  abacusRowsJsonSchema,
  applyCreditCardSignFlip,
  describeStatement,
  parseAbacusJson,
  validateTransactions,
  type Abacus,
  type AbacusStatement,
} from "./Abacus.js";
export {
  analyzeDateOrder,
  computeRunningBalances,
  normalizeChronological,
  normalizeExtractedTransactions,
  synthesizeRunningBalances,
  verifyClosingBalance,
  type DateOrderAnalysis,
  type DateTransition,
} from "./balances.js";
export { mergeStatements, validateStatementBoundaries } from "./merge.js";

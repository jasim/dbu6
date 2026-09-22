// What a report's server side is written against: the report half of
// `dbu6/server`, which re-exports every name here (index.ts), so a project's
// report and ours are written against the same list. A name is added on
// purpose: it is promised across versions.
//
// Our own reports import this module and no other in src/
// (scripts/import-boundaries.test.mjs); if one of ours needs something, a
// user's will, and it becomes an export here. They import this file rather
// than index.ts because index.ts also exports the application, which imports
// the reports: through this module there is no cycle, whichever module Node
// starts from. Keep it free of anything that imports a report.

// The contract: also all that `dbu6/server` is in a browser.
export * from "../shared/report-contract.js";
export { TsRestApi, type SapportaEnv } from "@sapporta/server";
// The signed-in user's books, read-only, and the ability check behind it.
export {
  readOnlyLedger,
  type ReportLedger,
} from "./modules/ledger-sql/index.js";
export type { AccountType } from "./schema/accounts.js";
export { openTestLedger, type TestLedger } from "./app/reports/testing.js";
// Columns, footers, links and the flat grid.
export {
  accountLedgerLink,
  authorizeReport,
  dateColumn,
  flatResult,
  footerRow,
  hiddenIdColumn,
  moneyColumn,
  monthEnd,
  openRecordLink,
  percentColumn,
  reportLedger,
  sum,
  textColumn,
  type ReportFooterInput,
} from "./app/reports/shared.js";
// Income and spending per account, and the account tree with totals.
export {
  loadAccountAmounts,
  loadMonthlyAmounts,
  type AccountAmount,
  type IncomeSpendingType,
  type MonthlyAmount,
} from "./app/reports/account-amounts.js";
export {
  accountTree,
  subtree,
  type AccountNode,
  type AmountAccount,
  type TreeAccount,
} from "./app/account-tree.js";
export {
  accountTreeLevel,
  accountTreeNodes,
} from "./app/reports/account-tree-level.js";

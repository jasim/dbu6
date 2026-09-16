import type { ComponentType } from "react";
import { AccountLedgerReport } from "./AccountLedgerReport";
import { AssetInflowsReport } from "./AssetInflowsReport";
import { BalanceAssertionsReport } from "./BalanceAssertionsReport";
import { BalanceSheetReport } from "./BalanceSheetReport";
import { DraftBalanceAssertionsReport } from "./DraftBalanceAssertionsReport";
import { DuplicateDraftsReport } from "./DuplicateDraftsReport";
import { ExpenseBreakdownReport } from "./ExpenseBreakdownReport";
import { IncomeExpensesPage } from "./income-expenses/IncomeExpensesPage";
import { IncomeStatementReport } from "./IncomeStatementReport";
import { LastReconciledReport } from "./LastReconciledReport";
import { MonthlySummaryReport } from "./MonthlySummaryReport";
import { NetWorthReport } from "./NetWorthReport";
import { TrialBalanceReport } from "./TrialBalanceReport";

/** The groups of the reports index, in the order it shows them. */
export const reportGroups = [
  { id: "statements", title: "Financial Statements" },
  { id: "ledgers", title: "Ledgers" },
  { id: "checks", title: "Checks" },
] as const;

export type ReportGroup = (typeof reportGroups)[number]["id"];

export interface ReportDefinition {
  id: string;
  /** The report's name, on its card, its screen and All tools. */
  label: string;
  /** One line on what it shows, in plain words. */
  description: string;
  Component: ComponentType;
  /**
   * Where the reports index lists it. Reports without a group repeat another
   * screen (Home, Review, or a report here), so only All tools lists them.
   */
  group?: ReportGroup;
}

/* The index lists each group's reports in this order. */
export const reportDefinitions = [
  {
    id: "income-expenses",
    label: "Income and Expenses",
    description: "See how much you spent against income, by month",
    Component: IncomeExpensesPage,
    group: "statements",
  },
  {
    id: "balance-sheet",
    label: "Balance Sheet",
    description: "All assets and liabilities",
    Component: BalanceSheetReport,
    group: "statements",
  },
  {
    id: "net-worth",
    label: "Net Worth Over Time",
    description: "Monthly list of assets, liabilities, and net worth",
    Component: NetWorthReport,
    group: "statements",
  },
  {
    id: "account-ledger",
    label: "Account Ledger",
    description: "Complete statement of an account",
    Component: AccountLedgerReport,
    group: "ledgers",
  },
  {
    id: "asset-inflows",
    label: "Asset Inflows",
    description: "Money that came in from outside your accounts",
    Component: AssetInflowsReport,
    group: "ledgers",
  },
  {
    id: "trial-balance",
    label: "Trial Balance",
    description: "List of all accounts and their balance",
    Component: TrialBalanceReport,
    group: "checks",
  },
  {
    id: "balance-assertions",
    label: "Reconciliation Differences",
    description: "Where the ledger and bank/CC statement balances disagree",
    Component: BalanceAssertionsReport,
    group: "checks",
  },
  {
    // Income and Expenses links to it.
    id: "income-statement",
    label: "Income Statement",
    description: "Revenue, expenses and net income",
    Component: IncomeStatementReport,
  },
  {
    // Income and Expenses charts each month.
    id: "monthly-summary",
    label: "Monthly Summary",
    description: "Totals for each month side by side",
    Component: MonthlySummaryReport,
  },
  {
    // Folded into Income and Expenses (P4).
    id: "expense-breakdown",
    label: "Expense Breakdown",
    description: "Expenses grouped and ranked",
    Component: ExpenseBreakdownReport,
  },
  {
    // Home shows each account's last checked date and balance.
    id: "last-reconciled",
    label: "Last Reconciled Entries",
    description: "The last date and balance recorded for each account",
    Component: LastReconciledReport,
  },
  {
    // Review's Balance checks tab.
    id: "draft-balance-assertions",
    label: "Draft Balance Assertions",
    description: "Balance checks for drafts not yet added",
    Component: DraftBalanceAssertionsReport,
  },
  {
    // Review's Duplicates tab.
    id: "duplicate-drafts",
    label: "Duplicate Drafts",
    description: "Drafts that may be repeats",
    Component: DuplicateDraftsReport,
  },
] as const satisfies readonly ReportDefinition[];

/** The reports of one group of the index, each with its route. */
export function reportsInGroup(
  group: ReportGroup,
): (ReportDefinition & { to: string })[] {
  const reports: readonly ReportDefinition[] = reportDefinitions;
  return reports
    .filter((report) => report.group === group)
    .map((report) => ({ ...report, to: `/reports/${report.id}` }));
}

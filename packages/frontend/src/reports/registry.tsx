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

/**
 * The sections of the reports index, in order. A section with two subgroups
 * shows them as columns; a section with one untitled subgroup lays its
 * reports out side by side.
 */
export const reportSections = [
  {
    title: "Financial Statements",
    subgroups: [
      { id: "income-and-spending", title: "Income and spending" },
      { id: "balances", title: "Balances" },
    ],
  },
  {
    title: "Ledgers",
    subgroups: [{ id: "ledgers", title: null }],
  },
  {
    title: "Checks",
    subgroups: [
      { id: "posted-entries", title: "Posted entries" },
      { id: "imported-drafts", title: "Imported drafts" },
    ],
  },
] as const;

export type ReportSection = (typeof reportSections)[number];
export type ReportSubgroup = ReportSection["subgroups"][number]["id"];

export interface ReportDefinition {
  id: string;
  /** The report's name, on its card and its screen. */
  label: string;
  /** One line on what it shows, in plain words. */
  description: string;
  Component: ComponentType;
  /** Where the reports index lists it. */
  subgroup: ReportSubgroup;
  /** Its card: a tile for the report that leads its subgroup, else a row. */
  layout: "row" | "tile";
}

/* The index lists each subgroup's reports in this order, most used first. */
export const reportDefinitions = [
  {
    id: "income-expenses",
    label: "Income and Expenses",
    description: "See how much you spent against income, by month",
    Component: IncomeExpensesPage,
    subgroup: "income-and-spending",
    layout: "tile",
  },
  {
    id: "expense-breakdown",
    label: "Expense Breakdown",
    description: "Spending by category, largest first",
    Component: ExpenseBreakdownReport,
    subgroup: "income-and-spending",
    layout: "row",
  },
  {
    id: "monthly-summary",
    label: "Monthly Summary",
    description: "Income, expenses, and savings rate for each month",
    Component: MonthlySummaryReport,
    subgroup: "income-and-spending",
    layout: "row",
  },
  {
    id: "income-statement",
    label: "Income Statement",
    description: "Income and expense totals per account, with net income",
    Component: IncomeStatementReport,
    subgroup: "income-and-spending",
    layout: "row",
  },
  {
    id: "balance-sheet",
    label: "Balance Sheet",
    description: "All assets and liabilities",
    Component: BalanceSheetReport,
    subgroup: "balances",
    layout: "tile",
  },
  {
    id: "net-worth",
    label: "Net Worth Over Time",
    description: "Monthly list of assets, liabilities, and net worth",
    Component: NetWorthReport,
    subgroup: "balances",
    layout: "row",
  },
  {
    id: "trial-balance",
    label: "Trial Balance",
    description: "List of all accounts and their balance",
    Component: TrialBalanceReport,
    subgroup: "balances",
    layout: "row",
  },
  {
    id: "account-ledger",
    label: "Account Ledger",
    description: "Complete statement of an account",
    Component: AccountLedgerReport,
    subgroup: "ledgers",
    layout: "row",
  },
  {
    id: "asset-inflows",
    label: "Asset Inflows",
    description: "Money that came in from outside your accounts",
    Component: AssetInflowsReport,
    subgroup: "ledgers",
    layout: "row",
  },
  {
    id: "balance-assertions",
    label: "Reconciliation Differences",
    description: "Where the ledger and bank/CC statement balances disagree",
    Component: BalanceAssertionsReport,
    subgroup: "posted-entries",
    layout: "row",
  },
  {
    id: "last-reconciled",
    label: "Last Reconciled Balances",
    description:
      "The date and account balances of the last statements posted in the books. Shows each account with its most recent balance assertion. Useful to determine which new statements need to be uploaded",
    Component: LastReconciledReport,
    subgroup: "posted-entries",
    layout: "row",
  },
  {
    id: "draft-balance-assertions",
    label: "Draft Reconciliation Differences",
    description: "Where the drafts and bank/CC statement balances disagree",
    Component: DraftBalanceAssertionsReport,
    subgroup: "imported-drafts",
    layout: "row",
  },
  {
    id: "duplicate-drafts",
    label: "Duplicate Drafts",
    description: "Drafts that may repeat a ledger entry or another draft",
    Component: DuplicateDraftsReport,
    subgroup: "imported-drafts",
    layout: "row",
  },
] as const satisfies readonly ReportDefinition[];

/** The reports of one subgroup of the index, each with its route. */
export function reportsIn(
  subgroup: ReportSubgroup,
): (ReportDefinition & { to: string })[] {
  const reports: readonly ReportDefinition[] = reportDefinitions;
  return reports
    .filter((report) => report.subgroup === subgroup)
    .map((report) => ({ ...report, to: `/reports/${report.id}` }));
}

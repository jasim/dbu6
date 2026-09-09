import type { ComponentType } from "react";
import { AccountLedgerReport } from "./AccountLedgerReport";
import { AssetInflowsReport } from "./AssetInflowsReport";
import { BalanceAssertionsReport } from "./BalanceAssertionsReport";
import { BalanceSheetReport } from "./BalanceSheetReport";
import { DraftBalanceAssertionsReport } from "./DraftBalanceAssertionsReport";
import { DuplicateDraftsReport } from "./DuplicateDraftsReport";
import { ExpenseBreakdownReport } from "./ExpenseBreakdownReport";
import { IncomeStatementReport } from "./IncomeStatementReport";
import { LastReconciledReport } from "./LastReconciledReport";
import { MonthlySummaryReport } from "./MonthlySummaryReport";
import { NetWorthReport } from "./NetWorthReport";
import { TrialBalanceReport } from "./TrialBalanceReport";

export interface ReportDefinition {
  id: string;
  label: string;
  Component: ComponentType;
}

export const reportDefinitions = [
  {
    id: "trial-balance",
    label: "Trial Balance",
    Component: TrialBalanceReport,
  },
  {
    id: "balance-sheet",
    label: "Balance Sheet",
    Component: BalanceSheetReport,
  },
  {
    id: "income-statement",
    label: "Income Statement",
    Component: IncomeStatementReport,
  },
  {
    id: "asset-inflows",
    label: "All In-flows to asset accounts",
    Component: AssetInflowsReport,
  },
  {
    id: "expense-breakdown",
    label: "Expense Breakdown",
    Component: ExpenseBreakdownReport,
  },
  {
    id: "account-ledger",
    label: "Account Ledger",
    Component: AccountLedgerReport,
  },
  {
    id: "monthly-summary",
    label: "Monthly Summary",
    Component: MonthlySummaryReport,
  },
  {
    id: "net-worth",
    label: "Net Worth Over Time",
    Component: NetWorthReport,
  },
  {
    id: "last-reconciled",
    label: "Last Reconciled Entries",
    Component: LastReconciledReport,
  },
  {
    id: "balance-assertions",
    label: "Balance Assertions",
    Component: BalanceAssertionsReport,
  },
  {
    id: "draft-balance-assertions",
    label: "Draft Balance Assertions",
    Component: DraftBalanceAssertionsReport,
  },
  {
    id: "duplicate-drafts",
    label: "Duplicate Drafts",
    Component: DuplicateDraftsReport,
  },
] as const satisfies readonly ReportDefinition[];

export const defaultReportPath = `/reports/${reportDefinitions[0].id}`;

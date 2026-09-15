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

/** How the reports index presents a report: a name and one line on what it shows. */
export interface ReportCard {
  label: string;
  description: string;
}

export interface ReportDefinition {
  id: string;
  /** The report's own name, as its screen and All tools show it. */
  label: string;
  Component: ComponentType;
  /** Its card among the everyday reports, in plain words, when it has one. */
  everyday?: ReportCard;
  /** Its card in the accounting view, when it has one. */
  accounting?: ReportCard;
}

/*
 * Until Step 6 builds the plain-language reports (P4, P7), an everyday card
 * and its accounting twin open the same screen. That is expected.
 */
export const reportDefinitions = [
  {
    id: "income-statement",
    label: "Income Statement",
    Component: IncomeStatementReport,
    everyday: {
      label: "Where your money went",
      description: "Income and spending for a period",
    },
    accounting: {
      label: "Income statement",
      description: "Revenue, expenses and net income",
    },
  },
  {
    id: "balance-sheet",
    label: "Balance Sheet",
    Component: BalanceSheetReport,
    everyday: {
      label: "What you own and owe",
      description: "Balance sheet, in plain words",
    },
    accounting: {
      label: "Balance sheet",
      description: "Assets, liabilities and equity",
    },
  },
  {
    id: "account-ledger",
    label: "Account Ledger",
    Component: AccountLedgerReport,
    everyday: {
      label: "Account history",
      description: "Every entry for one account",
    },
  },
  {
    id: "monthly-summary",
    label: "Monthly Summary",
    Component: MonthlySummaryReport,
    everyday: {
      label: "Month by month",
      description: "Totals for each month side by side",
    },
  },
  {
    id: "net-worth",
    label: "Net Worth Over Time",
    Component: NetWorthReport,
    everyday: {
      label: "Net worth over time",
      description: "How your position has changed",
    },
  },
  {
    id: "expense-breakdown",
    label: "Expense Breakdown",
    Component: ExpenseBreakdownReport,
    everyday: {
      label: "Spending breakdown",
      description: "Expenses grouped and ranked",
    },
  },
  {
    id: "trial-balance",
    label: "Trial Balance",
    Component: TrialBalanceReport,
    accounting: {
      label: "Trial balance",
      description: "Debit and credit totals per account",
    },
  },
  {
    id: "asset-inflows",
    label: "All In-flows to asset accounts",
    Component: AssetInflowsReport,
    accounting: {
      label: "All in-flows to asset accounts",
      description: "Every rupee that arrived",
    },
  },
  {
    id: "balance-assertions",
    label: "Balance Assertions",
    Component: BalanceAssertionsReport,
    accounting: {
      label: "Balance assertions",
      description: "Recorded balance checks",
    },
  },
  {
    id: "draft-balance-assertions",
    label: "Draft Balance Assertions",
    Component: DraftBalanceAssertionsReport,
    accounting: {
      label: "Draft balance assertions",
      description: "Balance checks for drafts not yet added",
    },
  },
  {
    id: "duplicate-drafts",
    label: "Duplicate Drafts",
    Component: DuplicateDraftsReport,
    accounting: {
      label: "Duplicate drafts",
      description: "Drafts that may be repeats",
    },
  },
  {
    id: "last-reconciled",
    label: "Last Reconciled Entries",
    Component: LastReconciledReport,
    accounting: {
      label: "Import checkpoint",
      description: "The last date and balance recorded for each account",
    },
  },
] as const satisfies readonly ReportDefinition[];

export type ReportGroup = "everyday" | "accounting";

/** The cards of one group of the reports index, each with its route. */
export function reportCards(
  group: ReportGroup,
): (ReportCard & { id: string; to: string })[] {
  const reports: readonly ReportDefinition[] = reportDefinitions;
  return reports.flatMap((report) => {
    const card = report[group];
    return card
      ? [{ ...card, id: report.id, to: `/reports/${report.id}` }]
      : [];
  });
}

/** One line on what a report shows, from whichever card it has. */
export function reportDescription(report: ReportDefinition): string {
  return (report.accounting ?? report.everyday)?.description ?? report.label;
}

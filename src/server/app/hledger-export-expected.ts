import {
  type ExpectedBalanceSheet,
  formatPaise,
} from "../modules/hledger-export/index.js";
import type { GridDataset, ReportLedger } from "../report-kit.js";
import { balanceSheetReport } from "./reports/balance-sheet.js";

// After every journal, so the Balance Sheet counts them all, as hledger does.
const END_OF_TIME = "9999-12-31";

/**
 * dbu6's Balance Sheet over every journal, as the figures verify.py checks
 * hledger's `bs` and `is` against: read off the report itself, so the check
 * compares hledger with what dbu6 shows.
 */
export function expectedBalanceSheet(
  ledger: ReportLedger,
): ExpectedBalanceSheet {
  return balanceSheetFigures(
    balanceSheetReport(ledger, { asOfDate: END_OF_TIME }),
  );
}

/**
 * The Balance Sheet's figures: each section's total, the computed
 * "Income less spending" row under Equity (0 when the report leaves it out),
 * and the Net worth row; the equity accounts' total is net worth less that
 * row, since the report shows no Equity total of its own.
 */
export function balanceSheetFigures(report: GridDataset): ExpectedBalanceSheet {
  const section = (type: string) =>
    report.nodes.find((node) => node.columns.account_type === type);
  const earnings = Number(
    section("Equity")?.children?.accounts?.find(
      (row) => row.rowKey === "retained-earnings",
    )?.columns.balance ?? 0,
  );
  const netWorth = Number(
    report.footerRows?.find((row) => row.rowKey === "net-worth")?.columns
      .section_total ?? 0,
  );
  const amount = (rupees: number) => formatPaise(Math.round(rupees * 100));
  return {
    assets: amount(Number(section("Asset")?.rollup?.section_total ?? 0)),
    liabilities: amount(
      Number(section("Liability")?.rollup?.section_total ?? 0),
    ),
    equity: amount(netWorth - earnings),
    income_less_spending: amount(earnings),
    net_worth: amount(netWorth),
  };
}

import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import { loadMonthlyAmounts, type MonthlyAmount } from "./account-amounts.js";
import {
  authorizeReport,
  dateColumn,
  flatResult,
  moneyColumn,
  monthEnd,
  percentColumn,
  sum,
  type ScopeParams,
} from "./shared.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "monthlySummary",
  reportsContract.monthlySummary,
  ({ c, request }) => {
    const scope = authorizeReport(c, "monthly-summary");
    return {
      status: 200,
      body: monthlySummaryReport(c.get("sqlite"), {
        ...scope,
        fromDate: request.query.from_date ?? null,
        toDate: request.query.to_date ?? null,
      }),
    };
  },
);

/** Income and spending for each month in the period with entries. */
export function monthlySummaryReport(
  sqlite: Database.Database,
  query: ScopeParams & { fromDate: string | null; toDate: string | null },
): GridDataset {
  const { fromDate, toDate, ...scope } = query;
  return toMonthlySummaryResult(
    loadMonthlyAmounts(sqlite, scope, { fromDate, toDate }),
  );
}

type MonthlySummaryRow = {
  // The month's first day, `YYYY-MM-01`, and its last.
  month: string;
  month_end: string;
  income: number;
  expenses: number;
  net: number;
  savings_rate: number;
};

function toMonthlySummaryResult(months: MonthlyAmount[]): GridDataset {
  const rows = months.map((row): MonthlySummaryRow => {
    const month = `${row.month}-01`;
    const net = row.income - row.spending;
    return {
      month,
      month_end: monthEnd(month),
      income: row.income,
      expenses: row.spending,
      net,
      savings_rate: row.income > 0 ? net / row.income : 0,
    };
  });
  const totalIncome = sum(rows, "income");
  const totalExpenses = sum(rows, "expenses");
  const totalNet = totalIncome - totalExpenses;
  const levelColumns = {
    month: [
      dateColumn("month", "Month", { width: 12 }),
      dateColumn("month_end", "Month End", { visuallyHidden: true }),
      moneyColumn("income", "Income", { width: 16 }),
      moneyColumn("expenses", "Expenses", {
        width: 16,
        links: [
          {
            kind: "report",
            report: "expense-breakdown",
            bind: { from_date: "month", to_date: "month_end" },
            label: "Open expense breakdown",
            icon: "report",
          },
        ],
      }),
      moneyColumn("net", "Net", {
        width: 16,
        colorRule: "signed",
        strong: true,
        links: [
          {
            kind: "report",
            report: "income-statement",
            bind: { from_date: "month", to_date: "month_end" },
            label: "Open income statement",
            icon: "report",
          },
        ],
      }),
      percentColumn("savings_rate", "Savings Rate", { width: 16 }),
    ],
  };
  return flatResult("monthly-summary", "Monthly Summary", levelColumns, rows, {
    rowKey: (row: MonthlySummaryRow) => `month:${row.month}`,
    footerRows: [
      {
        rowKey: "total",
        label: "Total",
        columns: {
          income: totalIncome,
          expenses: totalExpenses,
          net: totalNet,
          savings_rate: totalIncome > 0 ? totalNet / totalIncome : 0,
        },
      },
    ],
  });
}

export default api;

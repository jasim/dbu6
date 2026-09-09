import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import {
  allRows,
  authorizeReport,
  dateColumn,
  flatResult,
  ledgerCtes,
  moneyColumn,
  monthEnd,
  percentColumn,
  sum,
} from "./shared.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "monthlySummary",
  reportsContract.monthlySummary,
  ({ c, request }) => {
    const scope = authorizeReport(c, "monthly-summary");
    const rows = allRows<MonthlySummarySourceRow>(
      c.get("sqlite"),
      `${ledgerCtes}
    SELECT
      strftime('%Y-%m-01', j.date) AS month,
      COALESCE(SUM(CASE WHEN a.account_type = 'Revenue'
                        THEN je.credit - je.debit
                        ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN a.account_type = 'Expense'
                        THEN je.debit - je.credit
                        ELSE 0 END), 0) AS expenses
    FROM scoped_journal_entries je
    JOIN scoped_journals j ON j.id = je.journal_id
    JOIN scoped_accounts a ON a.id = je.account_id
    WHERE a.account_type IN ('Revenue', 'Expense')
      AND (@fromDate IS NULL OR j.date >= @fromDate)
      AND (@toDate IS NULL OR j.date <= @toDate)
    GROUP BY strftime('%Y-%m-01', j.date)
    ORDER BY strftime('%Y-%m-01', j.date)`,
      {
        ...scope,
        fromDate: request.query.from_date ?? null,
        toDate: request.query.to_date ?? null,
      },
    );

    return { status: 200, body: toMonthlySummaryResult(rows) };
  },
);

type MonthlySummarySourceRow = {
  month: string;
  income: number;
  expenses: number;
};

type MonthlySummaryRow = MonthlySummarySourceRow & {
  month_end: string;
  net: number;
  savings_rate: number;
};

function toMonthlySummaryResult(
  sourceRows: MonthlySummarySourceRow[],
): GridDataset {
  const rows = sourceRows.map((row) => {
    const net = Number(row.income ?? 0) - Number(row.expenses ?? 0);
    return {
      ...row,
      month_end: monthEnd(row.month),
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

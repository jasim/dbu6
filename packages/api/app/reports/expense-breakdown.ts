import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import {
  allRows,
  authorizeReport,
  footerRow,
  hiddenIdColumn,
  ledgerCtes,
  moneyColumn,
  openRecordLink,
  sum,
  textColumn,
} from "./shared.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "expenseBreakdown",
  reportsContract.expenseBreakdown,
  ({ c, request }) => {
    const scope = authorizeReport(c, "expense-breakdown");
    const rows = allRows<ExpenseBreakdownRow>(
      c.get("sqlite"),
      `${ledgerCtes}
      , categories AS (
        SELECT a.id AS category_id, a.name AS category_name
        FROM scoped_accounts a
        WHERE a.account_type = 'Expense'
          AND EXISTS (
            SELECT 1 FROM scoped_accounts child WHERE child.parent_id = a.id
          )
      ),
      descendants(category_id, id, parent_id) AS (
        SELECT c.category_id, a.id, a.parent_id
        FROM scoped_accounts a
        JOIN categories c ON a.parent_id = c.category_id
        UNION ALL
        SELECT d.category_id, a.id, a.parent_id
        FROM scoped_accounts a
        JOIN descendants d ON a.parent_id = d.id
      )
      SELECT
        c.category_id,
        c.category_name,
        a.id AS account_id,
        a.name,
        COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0) AS amount
      FROM categories c
      JOIN descendants d ON d.category_id = c.category_id
      JOIN scoped_accounts a ON a.id = d.id
      LEFT JOIN (
        SELECT je.account_id, je.debit, je.credit
        FROM scoped_journal_entries je
        JOIN scoped_journals j ON j.id = je.journal_id
        WHERE (@fromDate IS NULL OR j.date >= @fromDate)
          AND (@toDate IS NULL OR j.date <= @toDate)
      ) je ON je.account_id = a.id
      WHERE NOT EXISTS (
        SELECT 1 FROM scoped_accounts child WHERE child.parent_id = a.id
      )
      GROUP BY c.category_id, c.category_name, a.id, a.name
      HAVING COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0) != 0
      ORDER BY c.category_name, amount DESC`,
      {
        ...scope,
        fromDate: request.query.from_date ?? null,
        toDate: request.query.to_date ?? null,
      },
    );

    return { status: 200, body: toExpenseBreakdownResult(rows) };
  },
);

type ExpenseBreakdownRow = {
  category_id: number;
  category_name: string;
  account_id: number;
  name: string;
  amount: number;
};

function toExpenseBreakdownResult(rows: ExpenseBreakdownRow[]): GridDataset {
  const levelColumns = {
    category: [
      hiddenIdColumn("category_id", "Category ID"),
      textColumn("category_name", "Category", { width: 52 }),
      moneyColumn("category_total", "Total", { width: 18, strong: true }),
    ],
    accounts: [
      hiddenIdColumn("account_id", "Account ID"),
      textColumn("name", "Account", { width: 52 }),
      moneyColumn("amount", "Amount", { width: 18 }),
    ],
  };
  const categoryIds = Array.from(new Set(rows.map((row) => row.category_id)));
  const data = categoryIds
    .map((categoryId) => {
      const categoryRows = rows.filter((row) => row.category_id === categoryId);
      const first = categoryRows[0]!;
      return {
        rowKey: `category:${first.category_id}`,
        levelName: "category",
        columns: {
          category_id: first.category_id,
          category_name: first.category_name,
        },
        rollup: { category_total: sum(categoryRows, "amount") },
        children: {
          accounts: categoryRows.map((row) => ({
            rowKey: `account:${row.account_id}`,
            levelName: "accounts",
            columns: row,
          })),
        },
      };
    })
    .sort(
      (a, b) =>
        Number(b.rollup.category_total ?? 0) -
        Number(a.rollup.category_total ?? 0),
    );

  return {
    name: "expense-breakdown",
    label: "Expense Breakdown",
    rootLevel: "category",
    levels: {
      category: {
        columns: levelColumns.category,
        childLevels: ["accounts"],
        rowLinks: [
          openRecordLink("accounts", "category_id", "Open category account"),
        ],
      },
      accounts: {
        columns: levelColumns.accounts,
        childLevels: [],
        rowLinks: [openRecordLink("accounts", "account_id", "Open account")],
      },
    },
    nodes: data,
    footerRows: [
      footerRow(
        {
          rowKey: "total-expenses",
          label: "Total Expenses",
          columns: {
            category_total: data.reduce(
              (total, node) => total + Number(node.rollup.category_total ?? 0),
              0,
            ),
          },
        },
        levelColumns.category,
      ),
    ],
  };
}

export default api;

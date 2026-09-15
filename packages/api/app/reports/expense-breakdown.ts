import type Database from "better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import type { GridDataset } from "@sapporta/shared/grid-dataset";
import { reportsContract } from "dbu6-shared";
import { branchTops } from "../account-tree.js";
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
  type ScopeParams,
} from "./shared.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "expenseBreakdown",
  reportsContract.expenseBreakdown,
  ({ c, request }) => {
    const scope = authorizeReport(c, "expense-breakdown");
    return {
      status: 200,
      body: expenseBreakdownReport(c.get("sqlite"), {
        ...scope,
        fromDate: request.query.from_date ?? null,
        toDate: request.query.to_date ?? null,
      }),
    };
  },
);

/**
 * Spending in the period by category. A category is the top of a branch of
 * expense accounts (`branchTops`), and each account with entries of its own
 * is listed under exactly one, the category's own account included.
 */
export function expenseBreakdownReport(
  sqlite: Database.Database,
  query: ScopeParams & { fromDate: string | null; toDate: string | null },
): GridDataset {
  const accounts = allRows<ExpenseAccountRow>(
    sqlite,
    `${ledgerCtes}
      SELECT
        a.id AS account_id,
        a.name,
        a.parent_id,
        COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0) AS amount
      FROM scoped_accounts a
      LEFT JOIN (
        SELECT je.account_id, je.debit, je.credit
        FROM scoped_journal_entries je
        JOIN scoped_journals j ON j.id = je.journal_id
        WHERE (@fromDate IS NULL OR j.date >= @fromDate)
          AND (@toDate IS NULL OR j.date <= @toDate)
      ) je ON je.account_id = a.id
      WHERE a.account_type = 'Expense'
      GROUP BY a.id, a.name, a.parent_id`,
    query,
  );
  const tops = branchTops(accounts);
  const rows = accounts
    .filter((account) => account.amount !== 0)
    .map((account): ExpenseBreakdownRow => {
      const top = tops.get(account.account_id)!;
      return {
        category_id: top.account_id,
        category_name: top.name,
        account_id: account.account_id,
        name: account.name,
        amount: account.amount,
      };
    })
    .sort((a, b) => b.amount - a.amount);
  return toExpenseBreakdownResult(rows);
}

type ExpenseAccountRow = {
  account_id: number;
  name: string;
  parent_id: number | null;
  amount: number;
};

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

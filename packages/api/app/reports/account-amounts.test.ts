import Database from "better-sqlite3";
import {
  gridDatasetSchema,
  type GridDataset,
} from "@sapporta/shared/grid-dataset";
import { describe, expect, it } from "vitest";
import { loadAccountAmounts, loadMonthlyAmounts } from "./account-amounts.js";
import { expenseBreakdownReport } from "./expense-breakdown.js";
import { incomeStatementReport } from "./income-statement.js";
import { monthlySummaryReport } from "./monthly-summary.js";
import { testLedgerAuth } from "../../modules/ledger-sql/testing.js";

const auth = testLedgerAuth();
const allTime = { fromDate: null, toDate: null };

/*
 * Two months of income and spending. Food (1) has entries of its own and a
 * child; shopping (3) gets a refund larger than its purchase in February;
 * travel (4) has no entries at all. Another user's entry must never count.
 */
function ledger(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE accounts (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, name TEXT,
      parent_id INTEGER, account_type TEXT
    );
    CREATE TABLE journals (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT, description TEXT
    );
    CREATE TABLE journal_entries (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, journal_id INTEGER,
      account_id INTEGER, debit REAL, credit REAL, account_balance_assertion REAL,
      comment TEXT
    );
    CREATE TABLE draft_transactions (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'Food', NULL, 'Expense'),
      (2, 'workspace', 'user', 'Groceries', 1, 'Expense'),
      (3, 'workspace', 'user', 'Shopping', NULL, 'Expense'),
      (4, 'workspace', 'user', 'Travel', NULL, 'Expense'),
      (5, 'workspace', 'user', 'Salary', NULL, 'Revenue'),
      (6, 'workspace', 'user', 'Sample Savings', NULL, 'Asset');

    INSERT INTO journals VALUES
      (10, 'workspace', 'user', '2026-01-01', 'Salary'),
      (11, 'workspace', 'user', '2026-01-10', 'Spending'),
      (12, 'workspace', 'user', '2026-02-01', 'Salary'),
      (13, 'workspace', 'user', '2026-02-15', 'Spending and a refund'),
      (14, 'workspace', 'other-user', '2026-02-15', 'Not ours');

    INSERT INTO journal_entries
      (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit)
    VALUES
      (101, 'workspace', 'user', 10, 6, 50000, 0),
      (102, 'workspace', 'user', 10, 5, 0, 50000),
      (111, 'workspace', 'user', 11, 1, 500, 0),
      (112, 'workspace', 'user', 11, 2, 2000, 0),
      (113, 'workspace', 'user', 11, 3, 1000, 0),
      (114, 'workspace', 'user', 11, 6, 0, 3500),
      (121, 'workspace', 'user', 12, 6, 50000, 0),
      (122, 'workspace', 'user', 12, 5, 0, 50000),
      (131, 'workspace', 'user', 13, 2, 3000, 0),
      (132, 'workspace', 'user', 13, 3, 0, 1500),
      (133, 'workspace', 'user', 13, 6, 0, 1500),
      (141, 'workspace', 'other-user', 14, 2, 9000, 0);
  `);
  return sqlite;
}

describe("account amounts", () => {
  it("signs income and spending positive and lists accounts without entries", () => {
    const amounts = loadAccountAmounts(ledger(), auth, {
      types: ["Revenue", "Expense"],
      ...allTime,
    });

    expect(
      amounts.map((row) => [row.name, row.account_type, row.amount]),
    ).toEqual([
      ["Food", "Expense", 500],
      ["Groceries", "Expense", 5000],
      ["Salary", "Revenue", 100000],
      ["Shopping", "Expense", -500],
      ["Travel", "Expense", 0],
    ]);
  });

  it("keeps to the types and the dates asked for", () => {
    const amounts = loadAccountAmounts(ledger(), auth, {
      types: ["Expense"],
      fromDate: "2026-02-01",
      toDate: "2026-02-28",
    });

    expect(amounts.map((row) => [row.name, row.amount])).toEqual([
      ["Food", 0],
      ["Groceries", 3000],
      ["Shopping", -1500],
      ["Travel", 0],
    ]);
  });

  it("sums each month with entries", () => {
    expect(loadMonthlyAmounts(ledger(), auth, allTime)).toEqual([
      { month: "2026-01", income: 50000, spending: 3500 },
      { month: "2026-02", income: 50000, spending: 1500 },
    ]);
    expect(
      loadMonthlyAmounts(ledger(), auth, {
        fromDate: "2026-02-01",
        toDate: null,
      }),
    ).toEqual([{ month: "2026-02", income: 50000, spending: 1500 }]);
  });
});

function rootTotals(result: GridDataset, label: string, total: string) {
  return Object.fromEntries(
    gridDatasetSchema
      .parse(result)
      .nodes.map((node) => [
        String(node.columns[label]),
        Number(node.rollup?.[total]),
      ]),
  );
}

describe("the grids read the amounts", () => {
  it("income statement lists every account with an amount down the tree", () => {
    const result = incomeStatementReport(ledger(), auth, allTime);

    expect(rootTotals(result, "section", "section_total")).toEqual({
      Revenue: 100000,
      Expense: 5000,
    });
    expect(
      result.nodes[1]?.children?.accounts?.map((row) => [
        row.columns.name,
        row.columns.balance,
      ]),
    ).toEqual([
      ["Food", 5500],
      ["Groceries", 5000],
      ["Food, not in a sub-account", 500],
      ["Shopping", -500],
    ]);
  });

  it("spending breakdown totals the same spending by branch", () => {
    const result = expenseBreakdownReport(ledger(), auth, allTime);

    expect(rootTotals(result, "top_name", "top_total")).toEqual({
      Food: 5500,
      Shopping: -500,
    });
    expect(result.footerRows?.[0]?.columns.top_total).toBe(5000);
  });

  it("monthly summary shows each month's amounts", () => {
    const result = monthlySummaryReport(ledger(), auth, allTime);

    expect(
      gridDatasetSchema
        .parse(result)
        .nodes.map((node) => [
          node.columns.month,
          node.columns.month_end,
          node.columns.income,
          node.columns.expenses,
          node.columns.net,
        ]),
    ).toEqual([
      ["2026-01-01", "2026-01-31", 50000, 3500, 46500],
      ["2026-02-01", "2026-02-28", 50000, 1500, 48500],
    ]);
    expect(result.footerRows?.[0]?.columns.expenses).toBe(5000);
  });
});

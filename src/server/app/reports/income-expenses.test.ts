import Database from "better-sqlite3";
import {
  incomeExpensesSchema,
  reportsContract,
  type IncomeExpensesAccount,
} from "../../../shared/index.js";
import { describe, expect, it } from "vitest";
import { incomeExpensesReport, monthsBetween } from "./income-expenses.js";
import { incomeStatementReport } from "./income-statement.js";
import { sectionTotal } from "./section-account-grid.js";
import { readOnlyLedger } from "../../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../../modules/ledger-sql/testing.js";

const auth = testLedgerAuth();
const firstQuarter = {
  fromDate: "2026-01-01",
  toDate: "2026-03-31",
};

/*
 * Entries sit on parent accounts as well as leaves: food (1) and dining (3)
 * have children and entries of their own, and so does salary (6).
 * Restaurants (4) is three levels down; rent (5) has no children. Nothing
 * happens in February. A December entry is before the period, and one on
 * another user's books never counts.
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
      (3, 'workspace', 'user', 'Dining', 1, 'Expense'),
      (4, 'workspace', 'user', 'Restaurants', 3, 'Expense'),
      (5, 'workspace', 'user', 'Rent', NULL, 'Expense'),
      (6, 'workspace', 'user', 'Salary', NULL, 'Revenue'),
      (7, 'workspace', 'user', 'Bonus', 6, 'Revenue'),
      (8, 'workspace', 'user', 'Interest', NULL, 'Revenue'),
      (9, 'workspace', 'user', 'Sample Savings', NULL, 'Asset'),
      (20, 'workspace', 'user', 'Expenses', NULL, 'Expense');

    INSERT INTO journals VALUES
      (10, 'workspace', 'user', '2025-12-20', 'Before the period'),
      (11, 'workspace', 'user', '2026-01-01', 'Salary'),
      (12, 'workspace', 'user', '2026-01-05', 'Spending'),
      (13, 'workspace', 'user', '2026-03-05', 'Rent'),
      (14, 'workspace', 'other-user', '2026-03-05', 'Not ours');

    INSERT INTO journal_entries
      (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit)
    VALUES
      (101, 'workspace', 'user', 10, 9, 0, 1000),
      (102, 'workspace', 'user', 10, 2, 1000, 0),
      (111, 'workspace', 'user', 11, 9, 100000, 0),
      (112, 'workspace', 'user', 11, 6, 0, 90000),
      (113, 'workspace', 'user', 11, 7, 0, 10000),
      (121, 'workspace', 'user', 12, 2, 3000, 0),
      (122, 'workspace', 'user', 12, 1, 500, 0),
      (123, 'workspace', 'user', 12, 3, 1000, 0),
      (124, 'workspace', 'user', 12, 4, 1500, 0),
      (125, 'workspace', 'user', 12, 9, 0, 6000),
      (131, 'workspace', 'user', 13, 5, 20000, 0),
      (132, 'workspace', 'user', 13, 9, 0, 20000),
      (141, 'workspace', 'other-user', 14, 5, 9000, 0);
  `);
  return sqlite;
}

/** Each node as [name, own, total, children]. */
type Shape = [string, number, number, Shape[]];

function shape(accounts: IncomeExpensesAccount[]): Shape[] {
  return accounts.map((account) => [
    account.name,
    account.own,
    account.total,
    shape(account.children),
  ]);
}

describe("Income and Expenses", () => {
  it("lists each section as its account tree, ranked by total", () => {
    const report = incomeExpensesSchema.parse(
      incomeExpensesReport(readOnlyLedger(ledger(), auth), firstQuarter),
    );

    expect(report.spending.total).toBe(26000);
    expect(shape(report.spending.accounts)).toEqual([
      ["Rent", 20000, 20000, []],
      [
        "Food",
        500,
        6000,
        [
          ["Groceries", 3000, 3000, []],
          ["Dining", 1000, 2500, [["Restaurants", 1500, 1500, []]]],
        ],
      ],
    ]);
    expect(report.income.total).toBe(100000);
    expect(shape(report.income.accounts)).toEqual([
      ["Salary", 90000, 100000, [["Bonus", 10000, 10000, []]]],
    ]);
    expect(report.spending.accounts[1]).toMatchObject({
      account_id: 1,
      name: "Food",
    });
  });

  it("has the income statement's section totals and accounts, in its order, for the same dates", () => {
    const sqlite = ledger();
    const report = incomeExpensesReport(
      readOnlyLedger(sqlite, auth),
      firstQuarter,
    );
    const statement = incomeStatementReport(
      readOnlyLedger(sqlite, auth),
      firstQuarter,
    );

    expect(report.income.total).toBe(sectionTotal(statement.nodes, "Revenue"));
    expect(report.spending.total).toBe(
      sectionTotal(statement.nodes, "Expense"),
    );
    // Rows for a parent's own entries carry no account, so they drop out.
    const statementAccounts = (section: number) =>
      (statement.nodes[section]?.children?.accounts ?? [])
        .filter((row) => row.columns.account_id !== undefined)
        .map((row) => [row.columns.account_id, row.columns.balance]);
    const depthFirst = (accounts: IncomeExpensesAccount[]): number[][] =>
      accounts.flatMap((account) => [
        [account.account_id, account.total],
        ...depthFirst(account.children),
      ]);
    expect(statementAccounts(0)).toEqual(depthFirst(report.income.accounts));
    expect(statementAccounts(1)).toEqual(depthFirst(report.spending.accounts));
  });

  it("starts from one account above every group", () => {
    const sqlite = ledger();
    sqlite.exec("UPDATE accounts SET parent_id = 20 WHERE id IN (1, 5)");

    const report = incomeExpensesReport(
      readOnlyLedger(sqlite, auth),
      firstQuarter,
    );

    expect(report.spending.total).toBe(26000);
    expect(
      shape(report.spending.accounts).map(([name, own, total, children]) => [
        name,
        own,
        total,
        children.map(([child]) => child),
      ]),
    ).toEqual([["Expenses", 0, 26000, ["Rent", "Food"]]]);
  });

  it("throws on a loop in parent_id", () => {
    const sqlite = ledger();
    // Food (1) now sits under its own grandchild, restaurants (4).
    sqlite.exec("UPDATE accounts SET parent_id = 4 WHERE id = 1");

    expect(() =>
      incomeExpensesReport(readOnlyLedger(sqlite, auth), firstQuarter),
    ).toThrow("parent_id loops through accounts 1 → 4 → 3 → 1");
  });

  it("gives every month in the period, zero-filled, and the first month", () => {
    const report = incomeExpensesReport(
      readOnlyLedger(ledger(), auth),
      firstQuarter,
    );

    expect(report.months).toEqual([
      { month: "2026-01", income: 100000, spending: 6000 },
      { month: "2026-02", income: 0, spending: 0 },
      { month: "2026-03", income: 0, spending: 20000 },
    ]);
    expect(report.first_month).toBe("2025-12");
  });

  it("is empty for a period without entries, with the first month still known", () => {
    const report = incomeExpensesReport(readOnlyLedger(ledger(), auth), {
      fromDate: "2026-02-10",
      toDate: "2026-02-20",
    });

    expect(report).toEqual({
      income: { total: 0, accounts: [] },
      spending: { total: 0, accounts: [] },
      months: [{ month: "2026-02", income: 0, spending: 0 }],
      first_month: "2025-12",
    });
    expect(
      incomeExpensesReport(
        readOnlyLedger(new Database(":memory:").exec(schemaOnly()), auth),
        {
          fromDate: "2026-02-10",
          toDate: "2026-02-20",
        },
      ).first_month,
    ).toBeNull();
  });

  it("counts months across a new year", () => {
    expect(monthsBetween("2025-11-15", "2026-02-03")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(monthsBetween("2026-02-10", "2026-02-20")).toEqual(["2026-02"]);
  });
});

function schemaOnly(): string {
  return `
    CREATE TABLE accounts (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, name TEXT,
      parent_id INTEGER, account_type TEXT
    );
    CREATE TABLE journals (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT, description TEXT
    );
    CREATE TABLE journal_entries (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, journal_id INTEGER,
      account_id INTEGER, debit REAL, credit REAL
    );
    CREATE TABLE draft_transactions (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT
    );`;
}

describe("the income-expenses query", () => {
  const query = reportsContract.incomeExpenses.query;

  it("takes two calendar dates in order", () => {
    expect(
      query.safeParse({ from_date: "2026-01-01", to_date: "2026-01-01" })
        .success,
    ).toBe(true);
  });

  it.each([
    ["a missing date", { to_date: "2026-01-31" }],
    [
      "a date that isn't one",
      { from_date: "2026-02-30", to_date: "2026-03-31" },
    ],
    ["another format", { from_date: "01/01/2026", to_date: "2026-01-31" }],
    ["dates out of order", { from_date: "2026-02-01", to_date: "2026-01-31" }],
  ])("refuses %s", (_, value) => {
    expect(query.safeParse(value).success).toBe(false);
  });
});

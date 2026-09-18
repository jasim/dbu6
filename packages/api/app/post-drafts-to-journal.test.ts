import Database from "better-sqlite3";
import type { IncomeExpensesAccount } from "dbu6-shared";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { createTestAuthContext } from "@sapporta/server/testing";
import { accounts } from "../schema/accounts.js";
import { draftTransactions } from "../schema/draft-journals.js";
import { journalEntries, journals } from "../schema/journals.js";
import { postDraftsToJournal } from "./post-drafts-to-journal.js";
import { incomeExpensesReport } from "./reports/income-expenses.js";

const scope = { workspaceId: "workspace", userId: "user" };

const auth = createTestAuthContext({
  tables: [accounts, draftTransactions, journals, journalEntries],
  ...scope,
});

/*
 * Sample Savings (1) opened at 1,000. Its two drafts, a deposit and a
 * withdrawal, are categorised and end at the statement's 1,400.
 */
function ledger() {
  const sqlite = new Database(":memory:");
  const stamp = "'2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'";
  sqlite.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, name TEXT NOT NULL, parent_id INTEGER,
      account_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE draft_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, date TEXT NOT NULL, narration TEXT NOT NULL,
      withdrawal REAL NOT NULL DEFAULT 0, deposit REAL NOT NULL DEFAULT 0,
      account_id INTEGER, base_account_id INTEGER, balance_assertion_base_account REAL,
      source_reference TEXT, source_transaction_key TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, date TEXT NOT NULL, description TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, journal_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL, debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0, account_balance_assertion REAL, comment TEXT,
      source_reference TEXT, source_transaction_key TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'assets:bank:sample-savings', NULL, 'Asset', ${stamp}),
      (2, 'workspace', 'user', 'expenses:groceries', NULL, 'Expense', ${stamp}),
      (3, 'workspace', 'user', 'income:salary', NULL, 'Revenue', ${stamp});

    INSERT INTO journals VALUES (10, 'workspace', 'user', '2026-01-10', 'Opening', ${stamp});
    INSERT INTO journal_entries VALUES
      (101, 'workspace', 'user', 10, 1, 1000, 0, 1000, NULL, NULL, NULL, ${stamp}),
      (102, 'workspace', 'user', 10, 3, 0, 1000, NULL, NULL, NULL, NULL, ${stamp});

    INSERT INTO draft_transactions VALUES
      (201, 'workspace', 'user', '2026-02-01', 'NOPII salary', 0, 500, 3, 1, NULL, NULL, 'k-201', ${stamp}),
      (202, 'workspace', 'user', '2026-02-03', 'NOPII grocer', 100, 0, 2, 1, 1400, NULL, 'k-202', ${stamp});
  `);
  const posting = { db: drizzle(sqlite), sqlite, auth, scope };
  const count = (table: string) =>
    (
      sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
        n: number;
      }
    ).n;
  return { sqlite, posting, count };
}

describe("postDraftsToJournal", () => {
  it("refuses while a draft has no category", () => {
    const { sqlite, posting, count } = ledger();
    sqlite.exec(
      `UPDATE draft_transactions SET account_id = NULL WHERE id = 202`,
    );

    expect(postDraftsToJournal(posting, 1)).toMatchObject({
      status: 422,
      body: { code: "UNCATEGORIZED_DRAFTS", uncategorized_count: 1 },
    });
    expect([count("journals"), count("draft_transactions")]).toEqual([1, 2]);
  });

  it("refuses while a draft looks like another", () => {
    const { sqlite, posting, count } = ledger();
    sqlite.exec(`
      INSERT INTO draft_transactions
      SELECT 203, workspace_id, scoped_to_user_id, date, narration, withdrawal, deposit,
        account_id, base_account_id, NULL, source_reference, source_transaction_key,
        created_at, updated_at
      FROM draft_transactions WHERE id = 202
    `);

    expect(postDraftsToJournal(posting, 1)).toMatchObject({
      status: 422,
      body: { code: "DUPLICATE_DRAFTS", duplicate_count: 1 },
    });
    expect([count("journals"), count("draft_transactions")]).toEqual([1, 3]);
  });

  it("refuses while a balance check fails", () => {
    const { sqlite, posting, count } = ledger();
    sqlite.exec(
      `UPDATE draft_transactions SET balance_assertion_base_account = 1300 WHERE id = 202`,
    );

    expect(postDraftsToJournal(posting, 1)).toMatchObject({
      status: 422,
      body: { code: "FAILING_ASSERTIONS", failing_count: 1 },
    });
    expect([count("journals"), count("draft_transactions")]).toEqual([1, 2]);
  });

  it("refuses an account it can't find", () => {
    const { posting } = ledger();
    expect(postDraftsToJournal(posting, 99)).toMatchObject({ status: 404 });
  });

  it("adds the drafts to the books and clears them", () => {
    const { sqlite, posting, count } = ledger();

    expect(postDraftsToJournal(posting, 1)).toEqual({
      status: 200,
      body: {
        base_account: "assets:bank:sample-savings",
        journals_created: 2,
        entries_created: 4,
        drafts_posted: 2,
      },
    });
    expect(count("draft_transactions")).toBe(0);
    expect(
      sqlite
        .prepare(
          `SELECT j.date, e.account_id, e.debit, e.credit, e.account_balance_assertion
           FROM journal_entries e JOIN journals j ON j.id = e.journal_id
           WHERE j.id <> 10 ORDER BY j.date, e.id`,
        )
        .all(),
    ).toEqual([
      {
        date: "2026-02-01",
        account_id: 1,
        debit: 500,
        credit: 0,
        account_balance_assertion: null,
      },
      {
        date: "2026-02-01",
        account_id: 3,
        debit: 0,
        credit: 500,
        account_balance_assertion: null,
      },
      {
        date: "2026-02-03",
        account_id: 2,
        debit: 100,
        credit: 0,
        account_balance_assertion: null,
      },
      {
        date: "2026-02-03",
        account_id: 1,
        debit: 0,
        credit: 100,
        account_balance_assertion: 1400,
      },
    ]);
  });
});

/*
 * An account tree five levels deep, from food (1) down to tips (5), with
 * entries on parents as well as their children. Snacks (10) is named under
 * food but its parent_id is transport (9). Three drafts on savings (16): 700
 * to groceries (2), and two filed on parent accounts, 900 to food (1) and a
 * 5,000 deposit from salary (13), whose child is bonus (14).
 */
function treeLedger() {
  const sqlite = new Database(":memory:");
  const stamp = "'2026-01-20T00:00:00Z', '2026-01-20T00:00:00Z'";
  sqlite.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, name TEXT NOT NULL, parent_id INTEGER,
      account_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE draft_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, date TEXT NOT NULL, narration TEXT NOT NULL,
      withdrawal REAL NOT NULL DEFAULT 0, deposit REAL NOT NULL DEFAULT 0,
      account_id INTEGER, base_account_id INTEGER, balance_assertion_base_account REAL,
      source_reference TEXT, source_transaction_key TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, date TEXT NOT NULL, description TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, journal_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL, debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0, account_balance_assertion REAL, comment TEXT,
      source_reference TEXT, source_transaction_key TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'expenses:food', NULL, 'Expense', ${stamp}),
      (2, 'workspace', 'user', 'expenses:food:groceries', 1, 'Expense', ${stamp}),
      (3, 'workspace', 'user', 'expenses:food:dining', 1, 'Expense', ${stamp}),
      (4, 'workspace', 'user', 'expenses:food:dining:restaurants', 3, 'Expense', ${stamp}),
      (5, 'workspace', 'user', 'expenses:food:dining:restaurants:tips', 4, 'Expense', ${stamp}),
      (6, 'workspace', 'user', 'expenses:rent', NULL, 'Expense', ${stamp}),
      (7, 'workspace', 'user', 'expenses:travel', NULL, 'Expense', ${stamp}),
      (8, 'workspace', 'user', 'expenses:travel:flights', 7, 'Expense', ${stamp}),
      (9, 'workspace', 'user', 'expenses:transport', NULL, 'Expense', ${stamp}),
      (10, 'workspace', 'user', 'expenses:food:snacks', 9, 'Expense', ${stamp}),
      (11, 'workspace', 'user', 'expenses:unused', NULL, 'Expense', ${stamp}),
      (12, 'workspace', 'user', 'expenses:unused:sub', 11, 'Expense', ${stamp}),
      (13, 'workspace', 'user', 'income:salary', NULL, 'Revenue', ${stamp}),
      (14, 'workspace', 'user', 'income:salary:bonus', 13, 'Revenue', ${stamp}),
      (15, 'workspace', 'user', 'assets:bank', NULL, 'Asset', ${stamp}),
      (16, 'workspace', 'user', 'assets:bank:sample-savings', 15, 'Asset', ${stamp});

    INSERT INTO journals VALUES
      (10, 'workspace', 'user', '2026-01-01', 'Salary', ${stamp}),
      (11, 'workspace', 'user', '2026-01-05', 'Spending', ${stamp}),
      (12, 'workspace', 'user', '2026-01-06', 'Cash to the bank', ${stamp});

    INSERT INTO journal_entries VALUES
      (101, 'workspace', 'user', 10, 16, 100000, 0, NULL, NULL, NULL, NULL, ${stamp}),
      (102, 'workspace', 'user', 10, 13, 0, 90000, NULL, NULL, NULL, NULL, ${stamp}),
      (103, 'workspace', 'user', 10, 14, 0, 10000, NULL, NULL, NULL, NULL, ${stamp}),
      (111, 'workspace', 'user', 11, 1, 500, 0, NULL, NULL, NULL, NULL, ${stamp}),
      (112, 'workspace', 'user', 11, 2, 3000, 0, NULL, NULL, NULL, NULL, ${stamp}),
      (113, 'workspace', 'user', 11, 4, 1500, 0, NULL, NULL, NULL, NULL, ${stamp}),
      (114, 'workspace', 'user', 11, 5, 50, 0, NULL, NULL, NULL, NULL, ${stamp}),
      (115, 'workspace', 'user', 11, 6, 20000, 0, NULL, NULL, NULL, NULL, ${stamp}),
      (116, 'workspace', 'user', 11, 7, 800, 0, NULL, NULL, NULL, NULL, ${stamp}),
      (117, 'workspace', 'user', 11, 10, 200, 0, NULL, NULL, NULL, NULL, ${stamp}),
      (118, 'workspace', 'user', 11, 16, 0, 26050, NULL, NULL, NULL, NULL, ${stamp}),
      (121, 'workspace', 'user', 12, 15, 2000, 0, NULL, NULL, NULL, NULL, ${stamp}),
      (122, 'workspace', 'user', 12, 16, 0, 2000, NULL, NULL, NULL, NULL, ${stamp});

    INSERT INTO draft_transactions VALUES
      (201, 'workspace', 'user', '2026-01-20', 'NOPII sample grocer', 700, 0, 2, 16, NULL, NULL, 'k-201', ${stamp}),
      (202, 'workspace', 'user', '2026-01-20', 'NOPII sample cafe', 900, 0, 1, 16, NULL, NULL, 'k-202', ${stamp}),
      (203, 'workspace', 'user', '2026-01-20', 'NOPII sample employer', 0, 5000, 13, 16, NULL, NULL, 'k-203', ${stamp});
  `);
  const posting = { db: drizzle(sqlite), sqlite, auth, scope };
  const count = (table: string) =>
    (
      sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
        n: number;
      }
    ).n;
  return { sqlite, posting, count };
}

/** The node for an account, anywhere in the tree. */
function findNode(
  accounts: IncomeExpensesAccount[],
  accountId: number,
): IncomeExpensesAccount | undefined {
  for (const account of accounts) {
    if (account.account_id === accountId) return account;
    const found = findNode(account.children, accountId);
    if (found) return found;
  }
  return undefined;
}

describe("postDraftsToJournal on an account tree", () => {
  it("posts drafts filed on parent accounts to those accounts, and Income and Expenses counts them there", () => {
    const { sqlite, posting, count } = treeLedger();

    expect(postDraftsToJournal(posting, 16)).toMatchObject({ status: 200 });
    expect(
      sqlite
        .prepare(
          `SELECT account_id, debit, credit FROM journal_entries
           WHERE journal_id NOT IN (10, 11, 12) AND account_id <> 16
           ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { account_id: 2, debit: 700, credit: 0 },
      { account_id: 1, debit: 900, credit: 0 },
      { account_id: 13, debit: 0, credit: 5000 },
    ]);
    expect(count("draft_transactions")).toBe(0);

    const report = incomeExpensesReport(sqlite, {
      ...scope,
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });
    const figures = (accounts: IncomeExpensesAccount[], accountId: number) => {
      const node = findNode(accounts, accountId);
      return { own: node?.own, total: node?.total };
    };
    expect({
      food: figures(report.spending.accounts, 1),
      groceries: figures(report.spending.accounts, 2),
      spending: report.spending.total,
      salary: figures(report.income.accounts, 13),
      income: report.income.total,
    }).toEqual({
      food: { own: 1400, total: 6650 },
      groceries: { own: 3700, total: 3700 },
      spending: 27650,
      salary: { own: 95000, total: 105000 },
      income: 105000,
    });
  });
});

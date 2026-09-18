import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { loadLastReconciled } from "./last-reconciled.js";
import { testLedgerAuth } from "../ledger-sql/testing.js";

describe("Last reconciled query", () => {
  it("reports the latest assertion for every scoped account that has one", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE accounts (
        id INTEGER,
        workspace_id TEXT,
        scoped_to_user_id TEXT,
        name TEXT,
        parent_id INTEGER
      );
      CREATE TABLE journals (
        id INTEGER,
        workspace_id TEXT,
        scoped_to_user_id TEXT,
        date TEXT,
        description TEXT
      );
      CREATE TABLE journal_entries (
        id INTEGER,
        workspace_id TEXT,
        scoped_to_user_id TEXT,
        journal_id INTEGER,
        account_id INTEGER,
        debit REAL,
        credit REAL,
        account_balance_assertion REAL
      );
      CREATE TABLE draft_transactions (
        id INTEGER,
        workspace_id TEXT,
        scoped_to_user_id TEXT
      );

      INSERT INTO accounts VALUES
        (1, 'workspace', 'user', 'liabilities:credit-cards:sample-card', NULL),
        (2, 'workspace', 'user', 'assets:bank:sample-savings', NULL),
        (3, 'workspace', 'user', 'expenses:groceries', NULL),
        (4, 'workspace', 'user', 'assets:cash', NULL),
        (5, 'workspace', 'other-user', 'assets:bank:other-user', NULL),
        (6, 'other-workspace', 'user', 'assets:bank:other-workspace', NULL);

      INSERT INTO journals VALUES
        (10, 'workspace', 'user', '2026-01-10', 'Older savings assertion'),
        (11, 'workspace', 'user', '2026-02-10', 'Latest savings assertion'),
        (12, 'workspace', 'user', '2026-03-10', 'Later savings line without assertion'),
        (13, 'workspace', 'user', '2026-02-20', 'Card assertion, lower id'),
        (14, 'workspace', 'user', '2026-02-20', 'Card assertion, higher id'),
        (15, 'workspace', 'other-user', '2026-01-15', 'Other user'),
        (16, 'other-workspace', 'user', '2026-01-16', 'Other workspace');

      INSERT INTO journal_entries VALUES
        (101, 'workspace', 'user', 10, 2, 1000, 0, 1000),
        (102, 'workspace', 'user', 10, 3, 0, 1000, NULL),
        (103, 'workspace', 'user', 11, 2, 500, 0, 1500),
        (104, 'workspace', 'user', 11, 3, 0, 500, NULL),
        (105, 'workspace', 'user', 12, 2, 0, 200, NULL),
        (106, 'workspace', 'user', 12, 3, 200, 0, NULL),
        (107, 'workspace', 'user', 14, 1, 0, 300, 300),
        (108, 'workspace', 'user', 14, 3, 300, 0, NULL),
        (109, 'workspace', 'user', 13, 1, 0, 100, 100),
        (110, 'workspace', 'user', 13, 3, 100, 0, NULL),
        (111, 'workspace', 'other-user', 15, 5, 700, 0, 700),
        (112, 'other-workspace', 'user', 16, 6, 800, 0, 800);
    `);

    const rows = loadLastReconciled(sqlite, testLedgerAuth());

    expect(rows).toEqual([
      {
        account_id: 2,
        journal_id: 11,
        account_name: "assets:bank:sample-savings",
        last_reconciled_date: "2026-02-10",
        last_balance: 1500,
      },
      {
        account_id: 1,
        journal_id: 14,
        account_name: "liabilities:credit-cards:sample-card",
        last_reconciled_date: "2026-02-20",
        last_balance: 300,
      },
    ]);
  });
});

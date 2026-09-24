import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { allRows } from "../ledger-sql/index.js";
import { testLedgerAuth } from "../ledger-sql/testing.js";
import {
  baseAccountRunningBalanceCtes,
  countPostedAssertionFailures,
  failingDraftAssertionsSelect,
} from "./running-balance.js";

describe("shared draft running-balance query", () => {
  it("uses journal-before-draft ordering and returns the same failing rows for every caller", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE accounts (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, name TEXT);
      CREATE TABLE journals (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT, description TEXT);
      CREATE TABLE journal_entries (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, journal_id INTEGER, account_id INTEGER, debit REAL, credit REAL, account_balance_assertion REAL);
      CREATE TABLE draft_transactions (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT, base_account_id INTEGER, deposit REAL, withdrawal REAL, balance_assertion_base_account REAL);
      INSERT INTO accounts VALUES (1, 'workspace', 'user', 'Bank');
      INSERT INTO journals VALUES (1, 'workspace', 'user', '2026-05-07', 'Opening');
      INSERT INTO journal_entries VALUES (1, 'workspace', 'user', 1, 1, 100, 0, NULL);
      INSERT INTO draft_transactions VALUES (9, 'workspace', 'user', '2026-05-07', 1, 50, 0, 140);
    `);
    const rows = allRows(
      sqlite,
      testLedgerAuth(),
      `${baseAccountRunningBalanceCtes}
       SELECT * FROM (${failingDraftAssertionsSelect})`,
    );
    expect(rows).toEqual([
      {
        account_id: 1,
        date: "2026-05-07",
        draft_id: 9,
        running_balance: 150,
        assertion: 140,
        diff: 10,
      },
    ]);
  });

  it("adds a day's drafts up by id, so the day's last draft checks the whole day", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE journals (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT);
      CREATE TABLE journal_entries (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, journal_id INTEGER, account_id INTEGER, debit REAL, credit REAL);
      CREATE TABLE draft_transactions (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT, base_account_id INTEGER, deposit REAL, withdrawal REAL, balance_assertion_base_account REAL);
      INSERT INTO draft_transactions VALUES (8, 'workspace', 'user', '2026-05-07', 1, 1000, 0, 1500);
      INSERT INTO draft_transactions VALUES (4, 'workspace', 'user', '2026-05-07', 1, 500, 0, NULL);
      INSERT INTO draft_transactions VALUES (6, 'workspace', 'user', '2026-05-08', 1, 0, 200, 1400);
    `);
    const rows = allRows(
      sqlite,
      testLedgerAuth(),
      `${baseAccountRunningBalanceCtes}
       SELECT * FROM (${failingDraftAssertionsSelect})`,
    );
    expect(rows).toEqual([
      {
        account_id: 1,
        date: "2026-05-08",
        draft_id: 6,
        running_balance: 1300,
        assertion: 1400,
        diff: -100,
      },
    ]);
  });
});

describe("posted balance checks the books miss", () => {
  it("counts them by account, adding a day up by journal before its closing check", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE journals (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT);
      CREATE TABLE journal_entries (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, journal_id INTEGER, account_id INTEGER, debit REAL, credit REAL, account_balance_assertion REAL);
      INSERT INTO journals VALUES
        (1, 'workspace', 'user', '2026-05-07'),
        (2, 'workspace', 'user', '2026-05-07'),
        (3, 'workspace', 'user', '2026-05-08'),
        (4, 'workspace', 'other-user', '2026-05-08');
      INSERT INTO journal_entries VALUES
        -- Bank (1): the day's two journals come to 1500, as asserted.
        (11, 'workspace', 'user', 1, 1, 1000, 0, NULL),
        (12, 'workspace', 'user', 1, 9, 0, 1000, NULL),
        (21, 'workspace', 'user', 2, 1, 500, 0, 1500),
        (22, 'workspace', 'user', 2, 9, 0, 500, NULL),
        -- Card (2): -200 where the statement says -300.
        (31, 'workspace', 'user', 3, 2, 0, 200, -300),
        (32, 'workspace', 'user', 3, 9, 200, 0, NULL),
        -- Another user's rows stay out of scope.
        (41, 'workspace', 'other-user', 4, 1, 0, 50, 0);
    `);

    expect(countPostedAssertionFailures(sqlite, testLedgerAuth())).toEqual(
      new Map([[2, 1]]),
    );
  });
});

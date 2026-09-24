import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  loadLastReconciled,
  loadPostedKeysOn,
  lookupLastReconciled,
} from "./last-reconciled.js";
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
        (1, 'workspace', 'user', 'Sample Card', NULL),
        (2, 'workspace', 'user', 'Sample Savings', NULL),
        (3, 'workspace', 'user', 'Groceries', NULL),
        (4, 'workspace', 'user', 'Cash', NULL),
        (5, 'workspace', 'other-user', 'Other User Bank', NULL),
        (6, 'other-workspace', 'user', 'Other Workspace Bank', NULL);

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
        account_id: 1,
        journal_id: 14,
        account_name: "Sample Card",
        last_reconciled_date: "2026-02-20",
        last_balance: 300,
      },
      {
        account_id: 2,
        journal_id: 11,
        account_name: "Sample Savings",
        last_reconciled_date: "2026-02-10",
        last_balance: 1500,
      },
    ]);
  });
});

/*
 * Checkpoints that tie. Sample Savings (1) asserts on 1 Mar in journal 21 and
 * on 1 Apr in journal 20, whose id is lower. Sample Card (2) asserts twice in
 * its one journal, 22. Sample Wallet (3) has its checkpoint on 1 May, Sample
 * Purse (4) on 1 Feb.
 */
function tiedLedger(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE accounts (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, name TEXT
    );
    CREATE TABLE journals (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT
    );
    CREATE TABLE journal_entries (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, journal_id INTEGER,
      account_id INTEGER, account_balance_assertion REAL
    );
    CREATE TABLE draft_transactions (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'Sample Savings'),
      (2, 'workspace', 'user', 'Sample Card'),
      (3, 'workspace', 'user', 'Sample Wallet'),
      (4, 'workspace', 'user', 'Sample Purse');
    INSERT INTO journals VALUES
      (20, 'workspace', 'user', '2026-04-01'),
      (21, 'workspace', 'user', '2026-03-01'),
      (22, 'workspace', 'user', '2026-03-10'),
      (23, 'workspace', 'user', '2026-05-01'),
      (24, 'workspace', 'user', '2026-02-01');
    INSERT INTO journal_entries VALUES
      (201, 'workspace', 'user', 20, 1, 2000),
      (202, 'workspace', 'user', 21, 1, 1000),
      (203, 'workspace', 'user', 22, 2, 300),
      (204, 'workspace', 'user', 22, 2, 500),
      (205, 'workspace', 'user', 23, 3, 30),
      (206, 'workspace', 'user', 24, 4, 40);
  `);
  return sqlite;
}

describe("the last reconciled checkpoint", () => {
  const auth = testLedgerAuth();
  const checkpoints = (sqlite: Database.Database) =>
    loadLastReconciled(sqlite, auth).map((row) => [
      row.account_id,
      row.journal_id,
      row.last_balance,
    ]);

  it("is in the latest journal, by date and then id, one row per assertion there, in entry order", () => {
    expect(checkpoints(tiedLedger())).toEqual([
      [2, 22, 300],
      [2, 22, 500],
      [4, 24, 40],
      [1, 20, 2000],
      [3, 23, 30],
    ]);
  });

  it("is the later assertion when one journal asserts twice", () => {
    const standing = new Map(
      checkpoints(tiedLedger()).map(([account, , balance]) => [
        account,
        balance,
      ]),
    );
    expect(standing.get(2)).toBe(500);
    expect(lookupLastReconciled(tiedLedger(), auth, "Sample Card")).toEqual({
      date: "2026-03-10",
      balance: 500,
    });
  });

  it("is found for the account with a name, for an import", () => {
    const sqlite = tiedLedger();
    expect(
      loadLastReconciled(sqlite, auth, {
        accountName: "Sample Wallet",
      }).map((row) => row.account_id),
    ).toEqual([3]);
    expect(lookupLastReconciled(sqlite, auth, "Sample Wallet")).toEqual({
      date: "2026-05-01",
      balance: 30,
    });
    expect(lookupLastReconciled(sqlite, auth, "Sample Purse")).toEqual({
      date: "2026-02-01",
      balance: 40,
    });
    expect(lookupLastReconciled(sqlite, auth, "Sample Savings")).toEqual({
      date: "2026-04-01",
      balance: 2000,
    });
    expect(lookupLastReconciled(sqlite, auth, "Missing Account")).toBeNull();
  });
});

/*
 * Sample Savings (1) on 10 May: journal 30 is one imported row, journal 31 a
 * run of two (the grouped form, its keys on the category lines), journal 32 a
 * transfer posted from Sample Card's (2) statement. Journal 33 is Sample
 * Card's alone, journal 34 is on 11 May, and journal 35 belongs to another
 * user. On 12 May, journal 36 was entered by hand, with no key.
 */
function keyedLedger(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE accounts (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, name TEXT
    );
    CREATE TABLE journals (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT
    );
    CREATE TABLE journal_entries (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, journal_id INTEGER,
      account_id INTEGER, source_transaction_key TEXT
    );
    CREATE TABLE draft_transactions (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'Sample Savings'),
      (2, 'workspace', 'user', 'Sample Card'),
      (3, 'workspace', 'user', 'Groceries');
    INSERT INTO journals VALUES
      (30, 'workspace', 'user', '2026-05-10'),
      (31, 'workspace', 'user', '2026-05-10'),
      (32, 'workspace', 'user', '2026-05-10'),
      (33, 'workspace', 'user', '2026-05-10'),
      (34, 'workspace', 'user', '2026-05-11'),
      (35, 'workspace', 'other-user', '2026-05-10'),
      (36, 'workspace', 'user', '2026-05-12');
    INSERT INTO journal_entries VALUES
      (301, 'workspace', 'user', 30, 3, 'semantic:one'),
      (302, 'workspace', 'user', 30, 1, NULL),
      (311, 'workspace', 'user', 31, 3, 'ref:two'),
      (312, 'workspace', 'user', 31, 3, 'ref:three'),
      (313, 'workspace', 'user', 31, 1, NULL),
      (321, 'workspace', 'user', 32, 1, 'ref:card-payment'),
      (322, 'workspace', 'user', 32, 2, NULL),
      (331, 'workspace', 'user', 33, 3, 'ref:card-only'),
      (332, 'workspace', 'user', 33, 2, NULL),
      (341, 'workspace', 'user', 34, 3, 'ref:next-day'),
      (342, 'workspace', 'user', 34, 1, NULL),
      (351, 'workspace', 'other-user', 35, 1, NULL),
      (361, 'workspace', 'user', 36, 3, NULL),
      (362, 'workspace', 'user', 36, 1, NULL);
  `);
  return sqlite;
}

describe("the keys posted on a day", () => {
  const auth = testLedgerAuth();

  it("gathers every key on the day's journals that touch the account", () => {
    expect(loadPostedKeysOn(keyedLedger(), auth, 1, "2026-05-10")).toEqual(
      new Set(["semantic:one", "ref:two", "ref:three", "ref:card-payment"]),
    );
  });

  it("can't vouch for a day that holds a journal with no key", () => {
    expect(loadPostedKeysOn(keyedLedger(), auth, 1, "2026-05-12")).toBeNull();
  });
});

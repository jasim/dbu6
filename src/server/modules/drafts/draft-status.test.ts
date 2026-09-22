import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  NO_DRAFTS,
  postingBlocks,
  postingCheck,
  postingChecks,
} from "../../../shared/index.js";
import { draftCounts, loadDraftStatus } from "./draft-status.js";
import { testLedgerAuth } from "../ledger-sql/testing.js";

const auth = testLedgerAuth();

/*
 * Sample Savings (2) has a balance assertion of 1,500 on 10 Feb, then four
 * drafts: a categorised pair that repeats one source key (a possible duplicate,
 * and the reason the 2 Mar balance misses by 20), and a 5 Mar draft whose
 * balance matches again. No Preset (4) has one uncategorised draft and no
 * balances.
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
      comment TEXT, source_reference TEXT, source_transaction_key TEXT
    );
    CREATE TABLE draft_transactions (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT, narration TEXT,
      withdrawal REAL, deposit REAL, account_id INTEGER, base_account_id INTEGER,
      balance_assertion_base_account REAL, source_reference TEXT, source_transaction_key TEXT
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'Salary', NULL, 'Revenue'),
      (2, 'workspace', 'user', 'Sample Savings', NULL, 'Asset'),
      (3, 'workspace', 'user', 'Groceries', NULL, 'Expense'),
      (4, 'workspace', 'user', 'No Preset Bank', NULL, 'Asset'),
      (5, 'workspace', 'other-user', 'Sample Savings', NULL, 'Asset');

    INSERT INTO journals VALUES
      (10, 'workspace', 'user', '2026-01-10', 'Opening'),
      (11, 'workspace', 'user', '2026-02-10', 'Salary');

    INSERT INTO journal_entries VALUES
      (101, 'workspace', 'user', 10, 2, 1000, 0, 1000, NULL, NULL, NULL),
      (102, 'workspace', 'user', 10, 1, 0, 1000, NULL, NULL, NULL, NULL),
      (103, 'workspace', 'user', 11, 2, 500, 0, 1500, NULL, NULL, NULL),
      (104, 'workspace', 'user', 11, 1, 0, 500, NULL, NULL, NULL, NULL);

    INSERT INTO draft_transactions VALUES
      (201, 'workspace', 'user', '2026-03-01', 'NOPII interest', 0, 100, NULL, 2, 1600, NULL, 'k-201'),
      (202, 'workspace', 'user', '2026-03-02', 'NOPII grocer', 40, 0, 3, 2, NULL, NULL, 'k-202'),
      (203, 'workspace', 'user', '2026-03-02', 'NOPII grocer', 40, 0, 3, 2, 1500, NULL, 'k-202'),
      (204, 'workspace', 'user', '2026-03-05', 'NOPII refund', 0, 20, 3, 2, 1540, NULL, 'k-204'),
      (205, 'workspace', 'user', '2026-03-03', 'NOPII cash', 5, 0, NULL, 4, NULL, NULL, 'k-205'),
      (206, 'workspace', 'other-user', '2026-03-03', 'NOPII other', 5, 0, NULL, 5, 999, NULL, 'k-206');
  `);
  return sqlite;
}

describe("loadDraftStatus", () => {
  it("gives every account with drafts its counts, dates, closing balance and blocks", () => {
    const status = loadDraftStatus(ledger(), auth);

    expect(Array.from(status.keys()).sort()).toEqual([2, 4]);
    expect(status.get(2)).toMatchObject({
      account_id: 2,
      drafts: 4,
      uncategorised: 1,
      draft_span: { first_date: "2026-03-01", last_date: "2026-03-05" },
      balance_checks: 3,
      closing: { date: "2026-03-05", balance: 1540 },
      failing: [
        {
          account_id: 2,
          date: "2026-03-02",
          draft_id: 203,
          running_balance: 1520,
          assertion: 1500,
          diff: 20,
        },
      ],
    });
    expect(
      status
        .get(2)!
        .duplicates.map((row) => [
          row.draft_id,
          row.other_draft_id,
          row.match_type,
        ]),
    ).toEqual([[202, 203, "source-key"]]);
    expect(status.get(4)).toEqual({
      account_id: 4,
      drafts: 1,
      uncategorised: 1,
      draft_span: { first_date: "2026-03-03", last_date: "2026-03-03" },
      balance_checks: 0,
      closing: null,
      failing: [],
      duplicates: [],
    });
  });

  it("narrows every query to one account", () => {
    const sqlite = ledger();
    const all = loadDraftStatus(sqlite, auth);
    const one = loadDraftStatus(sqlite, auth, { accountId: 2 });

    expect(Array.from(one.keys())).toEqual([2]);
    expect(one.get(2)).toEqual(all.get(2));
    expect(loadDraftStatus(sqlite, auth, { accountId: 3 }).size).toBe(0);
  });

  it("counts an account with no drafts as nothing", () => {
    expect(draftCounts(undefined)).toEqual(NO_DRAFTS);
  });

  it("counts the balance checks the drafts carry and the ones that fail", () => {
    const status = loadDraftStatus(ledger(), auth);
    expect(draftCounts(status.get(2))).toMatchObject({
      balance_checks: 3,
      failing_checks: 1,
    });
  });
});

describe("postingChecks", () => {
  it("passes every check when the drafts are categorised and clean", () => {
    expect(
      postingChecks({ ...NO_DRAFTS, drafts: 21, balance_checks: 13 }),
    ).toEqual([
      { kind: "categories", state: "passes", drafts: 21 },
      { kind: "duplicates", state: "passes" },
      { kind: "balance-checks", state: "passes" },
    ]);
  });

  it("has no balance checks to pass when the drafts carry none, which doesn't block", () => {
    const counts = { ...NO_DRAFTS, drafts: 21 };
    expect(postingCheck(counts, "balance-checks")).toEqual({
      kind: "balance-checks",
      state: "none",
    });
    expect(postingBlocks(counts)).toEqual([]);
  });

  it("lists every block in tab order, problems marked apart from categories", () => {
    expect(
      postingBlocks({
        drafts: 21,
        uncategorised: 12,
        duplicates: 2,
        balance_checks: 13,
        failing_checks: 3,
      }),
    ).toEqual([
      {
        kind: "categories",
        state: "blocks",
        severity: "attention",
        count: 12,
      },
      { kind: "duplicates", state: "blocks", severity: "problem", count: 2 },
      {
        kind: "balance-checks",
        state: "blocks",
        severity: "problem",
        count: 3,
      },
    ]);
  });
});

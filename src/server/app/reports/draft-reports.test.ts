import Database from "better-sqlite3";
import {
  gridDatasetReferenceProblems,
  gridDatasetSchema,
} from "@sapporta/shared/grid-dataset";
import { describe, expect, it } from "vitest";
import { draftBalanceAssertionsReport } from "./draft-balance-assertions.js";
import { duplicateDraftsReport } from "./duplicate-drafts.js";
import { testLedgerAuth } from "../../modules/ledger-sql/testing.js";

const auth = testLedgerAuth();

/*
 * Sample Savings (2) has a balance assertion of 1,500 on 10 Feb, then four
 * drafts: a categorised pair that repeats one source key (a possible duplicate,
 * and the reason the 2 Mar balance misses by 20), and a 5 Mar draft whose
 * balance matches again. No Preset (4) has one uncategorised draft and no
 * balances. Sample Savings sits under Sample Banks, and Groceries under
 * Household.
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
      comment TEXT, source_reference TEXT, source_transaction_key TEXT, source_narration TEXT
    );
    CREATE TABLE draft_transactions (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT, source_narration TEXT,
      withdrawal REAL, deposit REAL, account_id INTEGER, base_account_id INTEGER,
      balance_assertion_base_account REAL, source_reference TEXT, source_transaction_key TEXT, comment TEXT
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'Salary', NULL, 'Revenue'),
      (2, 'workspace', 'user', 'Sample Savings', 7, 'Asset'),
      (3, 'workspace', 'user', 'Groceries', 6, 'Expense'),
      (4, 'workspace', 'user', 'No Preset Bank', NULL, 'Asset'),
      (5, 'workspace', 'other-user', 'Sample Savings', NULL, 'Asset'),
      (6, 'workspace', 'user', 'Household', NULL, 'Expense'),
      (7, 'workspace', 'user', 'Sample Banks', NULL, 'Asset');

    INSERT INTO journals VALUES
      (10, 'workspace', 'user', '2026-01-10', 'Opening'),
      (11, 'workspace', 'user', '2026-02-10', 'Salary');

    INSERT INTO journal_entries VALUES
      (101, 'workspace', 'user', 10, 2, 1000, 0, 1000, NULL, NULL, NULL, NULL),
      (102, 'workspace', 'user', 10, 1, 0, 1000, NULL, NULL, NULL, NULL, NULL),
      (103, 'workspace', 'user', 11, 2, 500, 0, 1500, NULL, NULL, NULL, NULL),
      (104, 'workspace', 'user', 11, 1, 0, 500, NULL, NULL, NULL, NULL, NULL);

    INSERT INTO draft_transactions VALUES
      (201, 'workspace', 'user', '2026-03-01', 'NOPII interest', 0, 100, NULL, 2, 1600, NULL, 'k-201', NULL),
      (202, 'workspace', 'user', '2026-03-02', 'NOPII grocer', 40, 0, 3, 2, NULL, NULL, 'k-202', NULL),
      (203, 'workspace', 'user', '2026-03-02', 'NOPII grocer', 40, 0, 3, 2, 1500, NULL, 'k-202', NULL),
      (204, 'workspace', 'user', '2026-03-05', 'NOPII refund', 0, 20, 3, 2, 1540, NULL, 'k-204', NULL),
      (205, 'workspace', 'user', '2026-03-03', 'NOPII cash', 5, 0, NULL, 4, NULL, NULL, 'k-205', NULL),
      (206, 'workspace', 'other-user', '2026-03-03', 'NOPII other', 5, 0, NULL, 5, 999, NULL, 'k-206', NULL);
  `);
  return sqlite;
}

describe("draft reports narrowed to one account", () => {
  it("lists only that account's failing checks, with the ledger link on the date", () => {
    const source = ledger();
    // A failing check on a second account, to be left out.
    source.exec(`
      UPDATE draft_transactions SET balance_assertion_base_account = 50 WHERE id = 205;
    `);

    const every = gridDatasetSchema.parse(
      draftBalanceAssertionsReport(source, auth),
    );
    const one = gridDatasetSchema.parse(
      draftBalanceAssertionsReport(source, auth, 2),
    );

    expect(every.nodes.map((node) => node.columns.draft_id)).toEqual([
      205, 203,
    ]);
    expect(one.nodes.map((node) => node.columns.draft_id)).toEqual([203]);
    const columns = one.levels[one.rootLevel]!.columns;
    expect(columns.map((column) => column.id)).not.toContain("account_name");
    expect(
      columns.find((column) => column.id === "date")?.links?.[0],
    ).toMatchObject({ kind: "report", report: "account-ledger" });
    // The Account column names the account in the hidden account_id.
    expect(
      every.levels[every.rootLevel]!.columns.find(
        (column) => column.id === "account_name",
      ),
    ).toMatchObject({
      reference: { table: "accounts", idColumn: "account_id" },
    });
    expect(gridDatasetReferenceProblems(every)).toEqual([]);
    expect(
      every.nodes.map((node) => [
        node.columns.account_name,
        node.columns.account_id,
      ]),
    ).toEqual([
      ["No Preset Bank", 4],
      ["Sample Savings", 2],
    ]);
  });

  it("lists only that account's possible duplicates, without the account column", () => {
    const source = ledger();
    source.exec(`
      INSERT INTO draft_transactions VALUES
        (207, 'workspace', 'user', '2026-03-03', 'NOPII cash', 5, 0, NULL, 4, NULL, NULL, 'k-205', NULL);
    `);

    const every = gridDatasetSchema.parse(duplicateDraftsReport(source, auth));
    const one = gridDatasetSchema.parse(duplicateDraftsReport(source, auth, 2));

    expect(every.nodes.map((node) => node.columns.draft_id)).toEqual([
      205, 202,
    ]);
    expect(one.nodes.map((node) => node.columns.draft_id)).toEqual([202]);
    expect(
      one.levels[one.rootLevel]!.columns.map((column) => column.id),
    ).not.toContain("base_account");
    expect(
      every.levels[every.rootLevel]!.columns.map((column) => column.id),
    ).toContain("base_account");
    // Each account column names its account in a hidden id column, null
    // for a draft without an account.
    const references = Object.fromEntries(
      every.levels[every.rootLevel]!.columns.flatMap((column) =>
        column.reference ? [[column.id, column.reference]] : [],
      ),
    );
    expect(references).toEqual({
      base_account: { table: "accounts", idColumn: "base_account_id" },
      draft_account: { table: "accounts", idColumn: "draft_account_id" },
      matched_account: { table: "accounts", idColumn: "matched_account_id" },
    });
    expect(gridDatasetReferenceProblems(every)).toEqual([]);
    expect(gridDatasetReferenceProblems(one)).toEqual([]);
    expect(
      every.nodes.map((node) => [
        node.columns.base_account_id,
        node.columns.draft_account_id,
        node.columns.matched_account_id,
      ]),
    ).toEqual([
      [4, null, null],
      [2, 3, 3],
    ]);
  });
});

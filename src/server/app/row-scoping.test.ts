import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { loadLedgerAccounts } from "../modules/accounts/index.js";
import { loadDraftStatus } from "../modules/drafts/index.js";
import {
  loadLastReconciled,
  lookupLastReconciled,
} from "../modules/journals/index.js";
import type { LedgerAuth } from "../modules/ledger-sql/index.js";
import { readOnlyLedger } from "../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { balanceSheetReport } from "./reports/balance-sheet.js";
import { sectionTotal } from "./reports/section-account-grid.js";

/*
 * Every read of the ledger sees only the request's own rows: the accounts,
 * the draft status, a report, and the last reconciled checkpoint, for every
 * account and for the one an import names.
 */

const SAVINGS = "Sample Savings";

/*
 * The user's ledger: Sample Savings (1) opened at 1,000 with a balance
 * assertion, and one draft taking it to 900.
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
      (1, 'workspace', 'user', '${SAVINGS}', NULL, 'Asset'),
      (2, 'workspace', 'user', 'Salary', NULL, 'Revenue'),
      (3, 'workspace', 'user', 'Groceries', NULL, 'Expense');
    INSERT INTO journals VALUES (10, 'workspace', 'user', '2026-01-10', 'Opening');
    INSERT INTO journal_entries VALUES
      (101, 'workspace', 'user', 10, 1, 1000, 0, 1000, NULL, NULL, NULL),
      (102, 'workspace', 'user', 10, 2, 0, 1000, NULL, NULL, NULL, NULL);
    INSERT INTO draft_transactions VALUES
      (201, 'workspace', 'user', '2026-02-01', 'NOPII grocer', 100, 0, 3, 1, 900, NULL, 'k-201');
  `);
  return sqlite;
}

/*
 * Rows the user must never see. Another user in the workspace keeps a Sample
 * Savings (11) of their own, at 5,000. The same user id in another workspace
 * holds an account of that name too, and an entry and a draft on the user's
 * own journal (10) and account (1), so any of them that leaked would change
 * what the user reads.
 */
function addOtherRows(sqlite: Database.Database): void {
  sqlite.exec(`
    INSERT INTO accounts VALUES
      (11, 'workspace', 'other-user', '${SAVINGS}', NULL, 'Asset'),
      (12, 'workspace', 'other-user', 'Salary', NULL, 'Revenue'),
      (21, 'other-workspace', 'user', '${SAVINGS}', NULL, 'Asset');
    INSERT INTO journals VALUES
      (20, 'workspace', 'other-user', '2026-01-20', 'NOPII opening'),
      (30, 'other-workspace', 'user', '2026-01-25', 'NOPII opening');
    INSERT INTO journal_entries VALUES
      (301, 'workspace', 'other-user', 20, 11, 5000, 0, 5000, NULL, NULL, NULL),
      (302, 'workspace', 'other-user', 20, 12, 0, 5000, NULL, NULL, NULL, NULL),
      (501, 'other-workspace', 'user', 30, 21, 3000, 0, 3000, NULL, NULL, NULL),
      (502, 'other-workspace', 'user', 10, 1, 2000, 0, 2000, NULL, NULL, NULL);
    INSERT INTO draft_transactions VALUES
      (401, 'workspace', 'other-user', '2026-02-01', 'NOPII grocer', 100, 0, NULL, 11, 4900, NULL, 'k-201'),
      (601, 'other-workspace', 'user', '2026-02-01', 'NOPII grocer', 100, 0, 3, 1, 100, NULL, 'k-201');
  `);
}

function reads(sqlite: Database.Database, auth: LedgerAuth) {
  return {
    accounts: loadLedgerAccounts(sqlite, auth),
    drafts: loadDraftStatus(sqlite, auth),
    balanceSheet: balanceSheetReport(readOnlyLedger(sqlite, auth), { asOfDate: "2026-12-31" }),
    checkpoints: loadLastReconciled(sqlite, auth),
    checkpoint: lookupLastReconciled(sqlite, auth, SAVINGS),
  };
}

describe("row scoping", () => {
  it("reads the same ledger once other users' rows are added", () => {
    const sqlite = ledger();
    const auth = testLedgerAuth();
    const before = reads(sqlite, auth);
    expect(before.drafts.get(1)).toMatchObject({ drafts: 1, failing: [] });
    expect(before.checkpoint).toEqual({ date: "2026-01-10", balance: 1000 });
    expect(sectionTotal(before.balanceSheet.nodes, "Asset")).toBe(1000);

    addOtherRows(sqlite);

    expect(reads(sqlite, auth)).toEqual(before);
  });

  it("gives another user their own rows", () => {
    const sqlite = ledger();
    addOtherRows(sqlite);

    const other = reads(sqlite, testLedgerAuth("other-user"));

    expect(other.accounts.map((account) => account.id)).toEqual([11, 12]);
    expect(Array.from(other.drafts.keys())).toEqual([11]);
    expect(other.drafts.get(11)).toMatchObject({ drafts: 1, failing: [] });
    expect(other.checkpoints.map((row) => row.account_id)).toEqual([11]);
    expect(other.checkpoint).toEqual({ date: "2026-01-20", balance: 5000 });
    expect(sectionTotal(other.balanceSheet.nodes, "Asset")).toBe(5000);
  });
});

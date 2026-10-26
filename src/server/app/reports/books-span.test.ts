import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { readOnlyLedger } from "../../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../../modules/ledger-sql/testing.js";
import { booksSpan } from "./books-span.js";

const auth = testLedgerAuth();

function ledger(journals: string): Database.Database {
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
      comment TEXT, source_narration TEXT
    );
    CREATE TABLE draft_transactions (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT
    );
    ${journals}
  `);
  return sqlite;
}

describe("the days the books cover", () => {
  it("runs from the first journal to the last, on the user's own books", () => {
    const sqlite = ledger(`
      INSERT INTO journals VALUES
        (1, 'workspace', 'user', '2025-03-04', 'NOPII first'),
        (2, 'workspace', 'user', '2026-01-20', 'NOPII last'),
        (3, 'workspace', 'user', '2025-08-01', 'NOPII between'),
        (4, 'workspace', 'other-user', '2020-01-01', 'NOPII not theirs');
    `);
    expect(booksSpan(readOnlyLedger(sqlite, auth))).toEqual({
      span: { first_date: "2025-03-04", last_date: "2026-01-20" },
    });
  });

  it("is null while the books are empty", () => {
    expect(booksSpan(readOnlyLedger(ledger(""), auth))).toEqual({
      span: null,
    });
  });
});

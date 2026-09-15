import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import type { RowScopeAuth } from "../bank-importer/draft-persistence.js";
import { postDraftsToJournal } from "./post-drafts-to-journal.js";

const scope = { workspaceId: "workspace", userId: "user" };

const auth: RowScopeAuth = {
  rowSecurity: {
    forTable: () => ({
      ownedRows: (predicate?: unknown) => predicate,
      insertValuesSync: (_db: unknown, input: unknown) => ({
        ...(input as object),
        workspace_id: "workspace",
        scoped_to_user_id: "user",
      }),
    }),
  },
};

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

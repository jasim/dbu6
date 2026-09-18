import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { parseAccount, unsafeAsChrono } from "../values/index.js";
import { parsePlainDate } from "@sapporta/shared/temporal";
import { accounts, accountsTable } from "../../schema/accounts.js";
import {
  draftTransactions,
  draftTransactionsTable,
} from "../../schema/draft-journals.js";
import {
  journalEntries,
  journalEntriesTable,
  journals,
  journalsTable,
} from "../../schema/journals.js";
import { persistDrafts, toDraftRows } from "./draft-persistence.js";
import { createTestAuthContext } from "@sapporta/server/testing";
import {
  AmbiguousDuplicateError,
  AssertionConflictError,
  type Abacus,
} from "../statement/index.js";

const auth = createTestAuthContext({
  tables: [accounts, draftTransactions, journals, journalEntries],
  workspaceId: "workspace",
  userId: "user",
});

describe("draft persistence reconciliation", () => {
  it("reimport after category change reuses the keyed draft and preserves user category", () => {
    const { db, sqlite } = setup();
    const transaction = tx("stable-key");
    const first = draftRows(db, transaction, "expenses:software");
    expect(
      persistDrafts(db, first.rows, first.expectedClosingByDate, auth),
    ).toMatchObject({ inserted: 1, duplicates: 0 });

    const second = draftRows(db, transaction, "expenses:office");
    expect(
      persistDrafts(db, second.rows, second.expectedClosingByDate, auth),
    ).toMatchObject({
      inserted: 0,
      duplicates: 1,
      draftDuplicates: 1,
    });

    const persisted = sqlite
      .prepare(
        "SELECT account_id, source_transaction_key FROM draft_transactions",
      )
      .all() as Array<{ account_id: number; source_transaction_key: string }>;
    expect(persisted).toEqual([
      { account_id: 2, source_transaction_key: "stable-key" },
    ]);
  });

  it("reimport after posting matches the keyed itemized journal entry", () => {
    const { db, sqlite } = setup();
    const journal = db
      .insert(journalsTable)
      .values({
        workspace_id: "workspace",
        scoped_to_user_id: "user",
        date: parsePlainDate("2026-05-06"),
        description: "Expenses",
      })
      .returning({ id: journalsTable.id })
      .get();
    db.insert(journalEntriesTable)
      .values([
        {
          workspace_id: "workspace",
          scoped_to_user_id: "user",
          journal_id: journal.id,
          account_id: 2,
          debit: 125.5,
          credit: 0,
          comment: "Merchant",
          source_transaction_key: "posted-key",
        },
        {
          workspace_id: "workspace",
          scoped_to_user_id: "user",
          journal_id: journal.id,
          account_id: 1,
          debit: 0,
          credit: 125.5,
        },
      ])
      .run();

    const rows = draftRows(db, tx("posted-key"), "expenses:software");
    expect(
      persistDrafts(db, rows.rows, rows.expectedClosingByDate, auth),
    ).toMatchObject({
      inserted: 0,
      duplicates: 1,
      journalDuplicates: 1,
    });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM draft_transactions").get(),
    ).toEqual({ count: 0 });
  });

  it("places one assertion on the final effective draft only after dedupe", () => {
    const { db, sqlite } = setup();
    const first = tx("first-key");
    const second: Abacus = {
      ...tx("second-key"),
      narration: "Second",
      withdrawal: 10,
      deposit: 0,
      balance: -235.5,
    };
    const categorized = unsafeAsChrono([
      { transaction: first, account: parseAccount("expenses:software") },
      { transaction: second, account: parseAccount("expenses:office") },
    ]);
    const prepared = toDraftRows(
      db,
      parseAccount("cc:stanc"),
      categorized,
      auth,
    );
    persistDrafts(db, prepared.rows, prepared.expectedClosingByDate, auth);

    expect(
      sqlite
        .prepare(
          "SELECT narration, balance_assertion_base_account AS assertion FROM draft_transactions ORDER BY id",
        )
        .all(),
    ).toEqual([
      { narration: "Merchant", assertion: null },
      { narration: "Second", assertion: -235.5 },
    ]);
  });

  it("rolls back an insert when a validated assertion conflicts", () => {
    const { db, sqlite } = setup();
    insertLegacyDraft(db, {
      narration: "Existing",
      accountId: 2,
      assertion: 999,
    });
    const prepared = draftRows(db, tx("new-key"), "expenses:office");
    expect(() =>
      persistDrafts(db, prepared.rows, prepared.expectedClosingByDate, auth),
    ).toThrow(AssertionConflictError);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM draft_transactions").get(),
    ).toEqual({ count: 1 });
  });

  it("returns a typed ambiguity and rolls back rather than choosing a legacy duplicate", () => {
    const { db, sqlite } = setup();
    insertLegacyDraft(db, {
      narration: "Merchant",
      accountId: 2,
      assertion: null,
    });
    insertLegacyDraft(db, {
      narration: "Merchant",
      accountId: 3,
      assertion: null,
    });
    const prepared = draftRows(db, tx("new-key"), "expenses:office");
    expect(() =>
      persistDrafts(db, prepared.rows, prepared.expectedClosingByDate, auth),
    ).toThrow(AmbiguousDuplicateError);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM draft_transactions").get(),
    ).toEqual({ count: 2 });
  });
});

function tx(sourceKey: string): Abacus {
  return {
    date: "2026-05-07",
    narration: "Merchant",
    withdrawal: 125.5,
    deposit: 0,
    balance: -225.5,
    source_reference: null,
    source_transaction_key: sourceKey,
  };
}

function draftRows(db: any, transaction: Abacus, category: string) {
  return toDraftRows(
    db,
    parseAccount("cc:stanc"),
    unsafeAsChrono([{ transaction, account: parseAccount(category) }]),
    auth,
  );
}

function insertLegacyDraft(
  db: any,
  input: { narration: string; accountId: number; assertion: number | null },
) {
  db.insert(draftTransactionsTable)
    .values({
      workspace_id: "workspace",
      scoped_to_user_id: "user",
      date: parsePlainDate("2026-05-07"),
      narration: input.narration,
      withdrawal: input.narration === "Existing" ? 1 : 125.5,
      deposit: 0,
      account_id: input.accountId,
      base_account_id: 1,
      balance_assertion_base_account: input.assertion,
    })
    .run();
}

function setup() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_id INTEGER,
      account_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE draft_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      narration TEXT NOT NULL,
      withdrawal REAL NOT NULL DEFAULT 0,
      deposit REAL NOT NULL DEFAULT 0,
      account_id INTEGER,
      base_account_id INTEGER,
      balance_assertion_base_account REAL,
      source_reference TEXT,
      source_transaction_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL,
      journal_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0,
      account_balance_assertion REAL,
      comment TEXT,
      source_reference TEXT,
      source_transaction_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const db = drizzle(sqlite);
  db.insert(accountsTable)
    .values([
      scopedAccount(1, "cc:stanc", "Liability"),
      scopedAccount(2, "expenses:software", "Expense"),
      scopedAccount(3, "expenses:office", "Expense"),
    ])
    .run();
  return { db, sqlite };
}

function scopedAccount(
  id: number,
  name: string,
  account_type: typeof accountsTable.$inferInsert.account_type,
): typeof accountsTable.$inferInsert {
  return {
    id,
    workspace_id: "workspace",
    scoped_to_user_id: "user",
    name,
    account_type,
  };
}

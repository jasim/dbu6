import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import type { Categorizer } from "../../modules/categorization/index.js";
import { testLedgerAuth } from "../../modules/ledger-sql/testing.js";
import type { Abacus } from "../../modules/statement/index.js";
import {
  parseAccount,
  unsafeAsChrono,
  type Account,
} from "../../modules/values/index.js";
import { accountsTable } from "../../schema/accounts.js";
import { runDraftImport } from "./draft-import.js";

const auth = testLedgerAuth();

// The accounts setup() inserts.
const BASE_ACCOUNT_ID = 1;
const GROCERIES_ACCOUNT_ID = 2;

// The rules name Groceries for the shop; the LLM can't run, so the rest stay
// uncategorized.
const categorizer: Categorizer = {
  classify: {
    ok: true,
    value: (transaction): Account | null =>
      transaction.narration.startsWith("NOPII SHOP")
        ? parseAccount("Groceries")
        : null,
  },
  customMappings: { ok: true, value: "" },
  llm: {
    agent: null,
    name: "no engine in tests",
    caller: { ready: false, reason: "no engine in tests" },
  },
};

describe("runDraftImport", () => {
  it("tallies only the drafts it saved, not the rows already waiting in Review", async () => {
    const { db } = setup();
    const known = [
      row("2026-09-01", "NOPII SHOP ONE", "sample-key-1"),
      row("2026-09-02", "NOPII UNKNOWN ONE", "sample-key-2"),
    ];
    await importRows(db, known);

    const again = await importRows(db, [
      ...known,
      row("2026-09-03", "NOPII SHOP TWO", "sample-key-3"),
    ]);

    expect(again.draft_transaction_count).toBe(1);
    expect(again.draft_duplicate_count).toBe(2);
    expect(again.base_account_id).toBe(BASE_ACCOUNT_ID);
    expect(again.categorization_tally).toEqual({
      by_rule: 1,
      by_llm: 0,
      same_account: 0,
      uncategorized: 0,
      accounts: [
        {
          account_id: GROCERIES_ACCOUNT_ID,
          account_name: "Groceries",
          count: 1,
        },
      ],
    });
  });
});

function row(date: string, narration: string, key: string): Abacus {
  return {
    date,
    narration,
    withdrawal: 1000,
    deposit: 0,
    balance: null,
    source_reference: null,
    source_transaction_key: key,
  };
}

function importRows(db: any, transactions: Abacus[]) {
  return runDraftImport({
    baseAccount: parseAccount("Sample Bank"),
    baseAccountId: BASE_ACCOUNT_ID,
    accountsByName: new Map([
      ["Sample Bank", { id: BASE_ACCOUNT_ID, account_type: "Asset" }],
      ["Groceries", { id: GROCERIES_ACCOUNT_ID, account_type: "Expense" }],
    ]),
    transactions: unsafeAsChrono(transactions),
    rawTransactionCount: transactions.length,
    categorizer,
    logPrefix: "draft-import test",
    db,
    auth,
  });
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
      scopedAccount(BASE_ACCOUNT_ID, "Sample Bank", "Asset"),
      scopedAccount(GROCERIES_ACCOUNT_ID, "Groceries", "Expense"),
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

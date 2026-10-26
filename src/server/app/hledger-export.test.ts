import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { describe, expect, it } from "vitest";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import hledgerExportApi from "./hledger-export.js";

/*
 * Sample Bank (1) is the presets' one account. It takes a salary in January
 * and pays Groceries in February, asserting its balance; Rent is paid from
 * Sample Card (6), which no preset lists, so that journal is general.
 */
function ledger() {
  const sqlite = new Database(":memory:");
  const stamp = "'2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'";
  const presetAccounts = JSON.stringify([
    {
      account_id: 1,
      name: "Sample Savings",
      is_credit_card: false,
      account_identifiers: [],
      custom_mappings_filenames: [],
    },
  ]);
  sqlite.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, name TEXT NOT NULL, parent_id INTEGER,
      account_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, source_narration TEXT
    );
    CREATE TABLE import_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL,
      scoped_to_user_id TEXT NOT NULL, name TEXT NOT NULL, parsers TEXT NOT NULL,
      accounts TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'Sample Bank', NULL, 'Asset', ${stamp}),
      (3, 'workspace', 'user', 'Groceries', NULL, 'Expense', ${stamp}),
      (4, 'workspace', 'user', 'Salary', NULL, 'Revenue', ${stamp}),
      (5, 'workspace', 'user', 'Rent', NULL, 'Expense', ${stamp}),
      (6, 'workspace', 'user', 'Sample Card', NULL, 'Liability', ${stamp});

    INSERT INTO import_presets VALUES
      (1, 'workspace', 'user', 'Sample Institution', '[]', '${presetAccounts}',
       '2026-03-01T00:00:00Z');

    INSERT INTO journals VALUES
      (10, 'workspace', 'user', '2026-01-15', 'NOPII salary', ${stamp}),
      (11, 'workspace', 'user', '2026-02-20', 'NOPII grocer', ${stamp}),
      (13, 'workspace', 'user', '2026-02-10', 'NOPII rent', ${stamp});
    INSERT INTO journal_entries VALUES
      (101, 'workspace', 'user', 10, 1, 1000, 0, NULL, NULL, NULL, NULL, ${stamp}, NULL),
      (102, 'workspace', 'user', 10, 4, 0, 1000, NULL, NULL, NULL, NULL, ${stamp}, NULL),
      (111, 'workspace', 'user', 11, 3, 100, 0, NULL, NULL, NULL, NULL, ${stamp}, NULL),
      (112, 'workspace', 'user', 11, 1, 0, 100, 900, NULL, NULL, NULL, ${stamp}, NULL),
      (131, 'workspace', 'user', 13, 5, 2000, 0, NULL, NULL, NULL, NULL, ${stamp}, NULL),
      (132, 'workspace', 'user', 13, 6, 0, 2000, NULL, NULL, NULL, NULL, ${stamp}, NULL);
  `);
  return sqlite;
}

function route(sqlite: Database.Database): TsRestApi<SapportaEnv> {
  const app = new TsRestApi<SapportaEnv>();
  app.use(async (c, next) => {
    c.set("sqlite", sqlite);
    c.set("db", drizzle(sqlite) as never);
    c.set("auth", testLedgerAuth());
    await next();
  });
  app.route("/", hledgerExportApi);
  return app;
}

type Exported = {
  files: { path: string; content: string; transaction_count: number }[];
  journal_count: number;
};

async function exportBooks(): Promise<Exported> {
  const response = await route(ledger()).request("/export/hledger");
  expect(response.status).toBe(200);
  return (await response.json()) as Exported;
}

describe("the books as hledger files", () => {
  it("lists main.journal first, then the preset account's file and the general one", async () => {
    const { files, journal_count } = await exportBooks();

    expect(journal_count).toBe(3);
    expect(files.map((file) => [file.path, file.transaction_count])).toEqual([
      ["main.journal", 0],
      ["sample-savings.journal", 2],
      ["general-journals.journal", 1],
    ]);
  });

  it("declares every account and includes each file from main.journal", async () => {
    const main = (await exportBooks()).files[0]!.content;

    expect(main.split("\n")[0]).toMatch(/^commodity 1,00,00,000\.00\b/);
    for (const account of [
      "Sample Bank",
      "Groceries",
      "Salary",
      "Rent",
      "Sample Card",
    ]) {
      expect(main).toContain(`account ${account}  ; type: `);
    }
    expect(main).toContain(
      "include sample-savings.journal\ninclude general-journals.journal",
    );
  });

  it("keeps the bank's balance assertion on its line", async () => {
    const savings = (await exportBooks()).files[1]!.content;

    expect(savings).toMatch(/Sample Bank\s+-100\.00 = 900\.00/);
    expect(savings).toContain("NOPII salary");
  });
});

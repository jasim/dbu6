import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { describe, expect, it } from "vitest";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import renderJournalsHledgerApi from "./render-journals-hledger.js";

/*
 * Sample Bank (1) has Sample Wallet (2) under it. In February the bank pays
 * Groceries, the wallet takes a split salary, and Rent is paid from elsewhere;
 * one bank journal is in January and one in March. The grocer journal asserts
 * Groceries' balance as well as the bank's.
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

    INSERT INTO accounts VALUES
      (1, 'workspace', 'user', 'Sample Bank', NULL, 'Asset', ${stamp}),
      (2, 'workspace', 'user', 'Sample Wallet', 1, 'Asset', ${stamp}),
      (3, 'workspace', 'user', 'Groceries', NULL, 'Expense', ${stamp}),
      (4, 'workspace', 'user', 'Salary', NULL, 'Revenue', ${stamp}),
      (5, 'workspace', 'user', 'Rent', NULL, 'Expense', ${stamp}),
      (6, 'workspace', 'user', 'Sample Card', NULL, 'Liability', ${stamp});

    INSERT INTO journals VALUES
      (10, 'workspace', 'user', '2026-01-15', 'NOPII january', ${stamp}),
      (11, 'workspace', 'user', '2026-02-20', 'NOPII grocer', ${stamp}),
      (12, 'workspace', 'user', '2026-02-05', 'NOPII salary', ${stamp}),
      (13, 'workspace', 'user', '2026-02-10', 'NOPII rent', ${stamp}),
      (14, 'workspace', 'user', '2026-03-02', 'NOPII march', ${stamp});
    INSERT INTO journal_entries VALUES
      (101, 'workspace', 'user', 10, 1, 1000, 0, NULL, NULL, NULL, NULL, ${stamp}, NULL),
      (102, 'workspace', 'user', 10, 4, 0, 1000, NULL, NULL, NULL, NULL, ${stamp}, NULL),
      (111, 'workspace', 'user', 11, 3, 100, 0, 4100, NULL, NULL, NULL, ${stamp}, NULL),
      (112, 'workspace', 'user', 11, 1, 0, 100, 900, NULL, NULL, NULL, ${stamp}, NULL),
      (121, 'workspace', 'user', 12, 2, 300, 0, NULL, NULL, NULL, NULL, ${stamp}, NULL),
      (122, 'workspace', 'user', 12, 1, 200, 0, NULL, NULL, NULL, NULL, ${stamp}, NULL),
      (123, 'workspace', 'user', 12, 4, 0, 500, NULL, NULL, NULL, NULL, ${stamp}, NULL),
      (131, 'workspace', 'user', 13, 5, 2000, 0, NULL, NULL, NULL, NULL, ${stamp}, NULL),
      (132, 'workspace', 'user', 13, 6, 0, 2000, NULL, NULL, NULL, NULL, ${stamp}, NULL),
      (141, 'workspace', 'user', 14, 1, 0, 50, NULL, NULL, NULL, NULL, ${stamp}, NULL),
      (142, 'workspace', 'user', 14, 3, 50, 0, NULL, NULL, NULL, NULL, ${stamp}, NULL);
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
  app.route("/", renderJournalsHledgerApi);
  return app;
}

async function render(query: string) {
  const response = await route(ledger()).request(
    `/reports/account-ledger/hledger?${query}`,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    hledger_journal: string;
    journal_count: number;
  };
}

describe("the Account Ledger as hledger", () => {
  it("renders the period's journals on the account and those under it, whole and oldest first, asserting only their balances", async () => {
    const result = await render(
      "account_id=1&from_date=2026-02-01&to_date=2026-02-28",
    );

    expect(result.journal_count).toBe(2);
    expect(result.hledger_journal).toBe(
      [
        "2026-02-05 NOPII salary",
        "    Sample Wallet                           300.00",
        "    Sample Bank                             200.00",
        "    Salary                                 -500.00",
        "",
        "2026-02-20 NOPII grocer",
        "    Groceries                               100.00",
        "    Sample Bank                            -100.00 = 900.00",
      ].join("\n"),
    );
  });

  it("renders every journal on the account when no period is given", async () => {
    const result = await render("account_id=1");

    expect(result.journal_count).toBe(4);
    expect(result.hledger_journal).toContain("2026-01-15 NOPII january");
    expect(result.hledger_journal).toContain("2026-03-02 NOPII march");
    expect(result.hledger_journal).not.toContain("NOPII rent");
  });
});

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePlainDate } from "@sapporta/shared/temporal";
import { draftTransactionsContract } from "dbu6-shared";
import { createTestAuthContext } from "@sapporta/server/testing";
import type { CategorizationLlm } from "../modules/categorization/index.js";
import { accounts, accountsTable } from "../schema/accounts.js";
import {
  draftTransactions,
  draftTransactionsTable,
} from "../schema/draft-journals.js";
import { classifyDraftTransactions } from "./reclassification.js";

const auth = createTestAuthContext({
  tables: [accounts, draftTransactions],
  workspaceId: "workspace",
  userId: "user",
});

// The engine would detect this machine's coding agents. The mapping rules
// categorize everything these tests classify, so the LLM is never asked.
const llm: CategorizationLlm = {
  agent: "claude-code",
  name: "Claude Code",
  caller: { ready: false, reason: "not called in these tests" },
};
vi.mock("../modules/coding-agent/categorization-llm.js", () => ({
  categorizationLlm: async () => llm,
}));

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("classifyDraftTransactions", () => {
  it("enriches from GPay before categorizing and persists both changes", async () => {
    const { db, sqlite } = setupDatabase();
    const dataDir = makeTempDir("draft-classification-data-");
    vi.stubEnv("SAPPORTA_DATA_DIR", dataDir);
    const configDir = join(dataDir, "user-config");
    mkdirSync(configDir);
    const gpayDir = makeTempDir("draft-classification-gpay-");
    const gpayPath = join(gpayDir, "My Activities.html");
    writeFileSync(
      join(configDir, "transaction_mappings.mjs"),
      `export const mappings = {
        exact: {},
        includes: [{ account: "expenses:coffee", values: ["COFFEE SHOP |"] }],
      };`,
    );
    writeFileSync(
      gpayPath,
      `<div>Sent ₹250 to Coffee Shop using Bank Account</div>
       <div>Apr 24, 2026, 10:15 AM</div>`,
    );

    const first = await classifyDraftTransactions({
      db,
      auth,
      ids: [1],
      customMappingsFilenames: [],
      gpayHtmlPath: gpayPath,
    });

    expect(first).toEqual({
      transactions: [
        {
          id: 1,
          narration: "Coffee Shop | UPI debit",
          account_id: 2,
          account_name: "expenses:coffee",
        },
      ],
      gpayEnrichedCount: 1,
      categorization: {
        agent: "claude-code",
        sent_count: 0,
        failed_count: 0,
        error: null,
      },
    });
    expect(
      sqlite
        .prepare(
          "SELECT narration, account_id FROM draft_transactions WHERE id = 1",
        )
        .get(),
    ).toEqual({ narration: "Coffee Shop | UPI debit", account_id: 2 });

    const second = await classifyDraftTransactions({
      db,
      auth,
      ids: [1],
      customMappingsFilenames: [],
      gpayHtmlPath: gpayPath,
    });
    expect(second.gpayEnrichedCount).toBe(0);
    expect(second.transactions[0].narration).toBe("Coffee Shop | UPI debit");

    sqlite.close();
  });
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function setupDatabase() {
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
  `);
  const db = drizzle(sqlite);
  db.insert(accountsTable)
    .values([
      scopedAccount(1, "assets:bank:federal", "Asset"),
      scopedAccount(2, "expenses:coffee", "Expense"),
    ])
    .run();
  db.insert(draftTransactionsTable)
    .values({
      id: 1,
      workspace_id: "workspace",
      scoped_to_user_id: "user",
      date: parsePlainDate("2026-04-24"),
      narration: "UPI debit",
      withdrawal: 250,
      deposit: 0,
      account_id: null,
      base_account_id: 1,
      balance_assertion_base_account: null,
    })
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

describe("draft classification response contract", () => {
  it("carries the categorization report with the transactions", () => {
    const report = {
      agent: "codex",
      sent_count: 3,
      failed_count: 3,
      error: "sample failure",
    };
    const transactions = [
      { id: 1, narration: "NOPII SHOP", account_id: null, account_name: null },
    ];

    expect(
      draftTransactionsContract.classifyDraftTransactions.responses[200].parse({
        transactions,
        categorization: report,
      }),
    ).toEqual({ transactions, categorization: report });
    expect(() =>
      draftTransactionsContract.classifyDraftTransactions.responses[200].parse(
        transactions,
      ),
    ).toThrow();
    expect(
      draftTransactionsContract.classifyDraftTransactionsWithGPay.responses[200].parse(
        { transactions, gpay_enriched_count: 0, categorization: report },
      ),
    ).toEqual({ transactions, gpay_enriched_count: 0, categorization: report });
  });
});

describe("GPay draft classification upload contract", () => {
  it("parses repeated form fields into typed classification input", () => {
    expect(
      draftTransactionsContract.classifyDraftTransactionsWithGPay.body.parse({
        ids: ["12", "34"],
        custom_mappings_filenames: ["federal.prompt", "shared.prompt"],
      }),
    ).toEqual({
      ids: [12, 34],
      custom_mappings_filenames: ["federal.prompt", "shared.prompt"],
    });
  });
});

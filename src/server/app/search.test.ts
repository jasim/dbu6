import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { SapportaEnv } from "@sapporta/server";
import type { SearchResults } from "../../shared/index.js";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { packageDir } from "../paths.js";
import searchApi from "./search.js";

/*
 * /api/search over HTTP: one search over the journals, the drafts and the
 * accounts. Which rows match is Sapporta's table search, tested there and in
 * schema/journals-search.test.ts; this checks what each group returns.
 */

const ME = "'workspace', 'user'";
const OTHER = "'workspace', 'other'";

function books() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: packageDir("migrations") });
  sqlite.exec(`
    INSERT INTO accounts
      (id, workspace_id, scoped_to_user_id, name, parent_id, account_type, created_at, updated_at)
    VALUES
      (1, ${ME}, 'Sample Savings', NULL, 'Asset', '', ''),
      (2, ${ME}, 'Groceries', NULL, 'Expense', '', ''),
      (3, ${ME}, 'Sample Card', NULL, 'Liability', '', ''),
      (9, ${OTHER}, 'Groceries', NULL, 'Expense', '', '');
    INSERT INTO journals
      (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at)
    VALUES
      (10, ${ME}, '2026-01-05', 'NOPII sample market', '', ''),
      (11, ${ME}, '2026-02-05', 'NOPII sample market', '', ''),
      (90, ${OTHER}, '2026-01-05', 'NOPII sample market', '', '');
    INSERT INTO journal_entries
      (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, comment, source_narration, source_reference, created_at, updated_at)
    VALUES
      (101, ${ME}, 10, 2, 2500, 0, NULL, 'UPI-sample-payee-050505', '0505051111', '', ''),
      (102, ${ME}, 10, 1, 0, 2500, NULL, NULL, NULL, '', ''),
      (111, ${ME}, 11, 2, 1000, 0, NULL, NULL, NULL, '', ''),
      (112, ${ME}, 11, 1, 0, 1000, NULL, NULL, NULL, '', ''),
      (901, ${OTHER}, 90, 9, 2500, 0, NULL, NULL, NULL, '', '');
    INSERT INTO draft_transactions
      (id, workspace_id, scoped_to_user_id, date, account_id, source_narration, comment, withdrawal, deposit, base_account_id, source_reference, created_at, updated_at)
    VALUES
      (201, ${ME}, '2026-03-01', NULL, 'UPI-sample-payee-050505', NULL, 500, 0, 3, '0505052222', '', ''),
      (202, ${ME}, '2026-03-02', 2, 'NOPII sample market', 'weekly sample shop', 2500, 0, 3, NULL, '', '');
  `);

  const app = new Hono<SapportaEnv>();
  app.use("*", async (c, next) => {
    c.set("auth", testLedgerAuth());
    c.set("db", db as never);
    c.set("sqlite", sqlite);
    await next();
  });
  app.route("/", searchApi);

  const search = async (q: string): Promise<SearchResults> => {
    const response = await app.request(`/search?${new URLSearchParams({ q })}`);
    expect(response.status).toBe(200);
    return (await response.json()) as SearchResults;
  };
  return { search };
}

const ids = (rows: readonly { id: number }[]) => rows.map((row) => row.id);

describe("GET /api/search", () => {
  it("returns matching journals newest first, with their accounts and amount", async () => {
    const { search } = books();
    const results = await search("sample market");

    expect(results.words).toEqual(["sample", "market"]);
    expect(results.journals).toEqual([
      {
        id: 11,
        date: "2026-02-05",
        description: "NOPII sample market",
        accounts: expect.arrayContaining(["Groceries", "Sample Savings"]),
        amount: 1000,
      },
      expect.objectContaining({ id: 10, amount: 2500 }),
    ]);
    expect(ids(results.drafts)).toEqual([202]);
  });

  it("returns drafts on their own, with the statement account and category", async () => {
    const { search } = books();
    const results = await search("sample-payee");

    expect(ids(results.journals)).toEqual([10]);
    expect(results.drafts).toEqual([
      {
        id: 201,
        date: "2026-03-01",
        narration: "UPI-sample-payee-050505",
        comment: null,
        amount: -500,
        base_account_id: 3,
        base_account_name: "Sample Card",
        account_name: null,
      },
    ]);
  });

  it("finds by reference, amount and account name across the groups", async () => {
    const { search } = books();

    expect(ids((await search("0505052222")).drafts)).toEqual([201]);
    const byAmount = await search("2,500");
    expect(ids(byAmount.journals)).toEqual([10]);
    expect(ids(byAmount.drafts)).toEqual([202]);
    const byAccount = await search("groceries");
    expect(ids(byAccount.accounts)).toEqual([2]);
    expect(ids(byAccount.journals)).toEqual([11, 10]);
    expect(ids(byAccount.drafts)).toEqual([202]);
  });

  it("returns nothing for an empty search, and never another user's rows", async () => {
    const { search } = books();

    const empty = await search("   ");
    expect(empty.journals).toEqual([]);
    expect(empty.drafts).toEqual([]);
    expect(empty.accounts).toEqual([]);
    const all = await search("sample");
    expect(ids(all.journals)).not.toContain(90);
    expect(ids((await search("groceries")).accounts)).not.toContain(9);
  });
});

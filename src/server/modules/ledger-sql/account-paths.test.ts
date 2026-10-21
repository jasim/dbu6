import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { computeFields } from "@sapporta/server";
import { accounts } from "../../schema/accounts.js";
import { loadAccountParentPaths } from "../accounts/index.js";
import { allRows } from "./index.js";
import { testLedgerAuth } from "./testing.js";

function chartDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
      CREATE TABLE accounts (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, name TEXT, parent_id INTEGER);
      INSERT INTO accounts VALUES (1, 'workspace', 'user', 'Expenses', NULL);
      INSERT INTO accounts VALUES (2, 'workspace', 'user', 'Kitchen', 1);
      INSERT INTO accounts VALUES (3, 'workspace', 'user', 'Groceries', 2);
      INSERT INTO accounts VALUES (4, 'workspace', 'user', 'Assets', NULL);
    `);
  return sqlite;
}

describe("scoped_account_paths", () => {
  it("gives every account its parent path, as loadAccountParentPaths does", () => {
    const sqlite = chartDatabase();
    const rows = allRows<{ id: number; parent_path: string | null }>(
      sqlite,
      testLedgerAuth(),
      `SELECT a.id, p.parent_path
       FROM scoped_accounts a
       LEFT JOIN scoped_account_paths p ON p.id = a.id
       ORDER BY a.id`,
    );
    expect(rows).toEqual([
      { id: 1, parent_path: null },
      { id: 2, parent_path: "Expenses" },
      { id: 3, parent_path: "Expenses > Kitchen" },
      { id: 4, parent_path: null },
    ]);
    expect(new Map(rows.map((row) => [row.id, row.parent_path]))).toEqual(
      loadAccountParentPaths(drizzle(sqlite), testLedgerAuth()),
    );
  });

  it("agrees with the parent path Sapporta computes for the accounts table", async () => {
    const sqlite = chartDatabase();
    const computed = await computeFields({
      db: drizzle(sqlite),
      auth: testLedgerAuth(),
      table: accounts,
      ids: ["1", "2", "3", "4"],
      names: ["parentPath"],
    });
    expect(computed.parentPath).toEqual({
      "1": null,
      "2": "Expenses",
      "3": "Expenses > Kitchen",
      "4": null,
    });
  });
});

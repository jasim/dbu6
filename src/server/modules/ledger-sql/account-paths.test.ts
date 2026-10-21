import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { accountParentPaths } from "../../../shared/index.js";
import { allRows } from "./index.js";
import { testLedgerAuth } from "./testing.js";

describe("scoped_account_paths", () => {
  it("gives every account the parent path accountParentPaths gives it", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE accounts (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, name TEXT, parent_id INTEGER);
      INSERT INTO accounts VALUES (1, 'workspace', 'user', 'Expenses', NULL);
      INSERT INTO accounts VALUES (2, 'workspace', 'user', 'Kitchen', 1);
      INSERT INTO accounts VALUES (3, 'workspace', 'user', 'Groceries', 2);
      INSERT INTO accounts VALUES (4, 'workspace', 'user', 'Assets', NULL);
    `);
    const rows = allRows<{ id: number; parent_path: string | null }>(
      sqlite,
      testLedgerAuth(),
      `SELECT a.id, p.parent_path
       FROM scoped_accounts a
       LEFT JOIN scoped_account_paths p ON p.id = a.id
       ORDER BY a.id`,
    );
    const chart = allRows<{ id: number; name: string; parent_id: number }>(
      sqlite,
      testLedgerAuth(),
      `SELECT id, name, parent_id FROM scoped_accounts`,
    );
    expect(rows).toEqual([
      { id: 1, parent_path: null },
      { id: 2, parent_path: "Expenses" },
      { id: 3, parent_path: "Expenses > Kitchen" },
      { id: 4, parent_path: null },
    ]);
    expect(new Map(rows.map((row) => [row.id, row.parent_path]))).toEqual(
      accountParentPaths(chart),
    );
  });
});

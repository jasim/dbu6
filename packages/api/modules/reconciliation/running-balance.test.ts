import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ledgerCtes } from "../ledger-sql/index.js";
import {
  baseAccountRunningBalanceCtes,
  failingDraftAssertionsSelect,
} from "./running-balance.js";

describe("shared draft running-balance query", () => {
  it("uses journal-before-draft ordering and returns the same failing rows for every caller", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE accounts (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, name TEXT);
      CREATE TABLE journals (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT, description TEXT);
      CREATE TABLE journal_entries (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, journal_id INTEGER, account_id INTEGER, debit REAL, credit REAL, account_balance_assertion REAL);
      CREATE TABLE draft_transactions (id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT, base_account_id INTEGER, deposit REAL, withdrawal REAL, balance_assertion_base_account REAL);
      INSERT INTO accounts VALUES (1, 'workspace', 'user', 'assets:bank');
      INSERT INTO journals VALUES (1, 'workspace', 'user', '2026-05-07', 'Opening');
      INSERT INTO journal_entries VALUES (1, 'workspace', 'user', 1, 1, 100, 0, NULL);
      INSERT INTO draft_transactions VALUES (9, 'workspace', 'user', '2026-05-07', 1, 50, 0, 140);
    `);
    const rows = sqlite
      .prepare(
        `${ledgerCtes}${baseAccountRunningBalanceCtes}
         SELECT * FROM (${failingDraftAssertionsSelect})`,
      )
      .all({ workspaceId: "workspace", userId: "user" });
    expect(rows).toEqual([
      {
        account_id: 1,
        date: "2026-05-07",
        draft_id: 9,
        running_balance: 150,
        assertion: 140,
        diff: 10,
      },
    ]);
  });
});

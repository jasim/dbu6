import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  applyMigrations,
  buildSearchPredicate,
  createTableCatalog,
  scopedRows,
} from "@sapporta/server";
import { describe, expect, it } from "vitest";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { dbu6MigrationsDir } from "../paths.js";
import { accounts } from "./accounts.js";
import { journalEntries, journals } from "./journals.js";

const SCOPE = "'workspace', 'user'";
const AT = "'2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'";

/*
 * The Journals page's search. A one-row import's description is its comment
 * once the comment writer reaches it, so the bank's text is found through
 * the entries.
 */
function books() {
  const sqlite = new Database(":memory:");
  applyMigrations(sqlite, dbu6MigrationsDir());
  sqlite.exec(`
    INSERT INTO accounts (id, workspace_id, scoped_to_user_id, name, account_type, created_at, updated_at) VALUES
      (1, ${SCOPE}, 'Sample Savings', 'Asset', ${AT}),
      (2, ${SCOPE}, 'Eating Out', 'Expense', ${AT});
    INSERT INTO journals (id, workspace_id, scoped_to_user_id, date, description, created_at, updated_at) VALUES
      (10, ${SCOPE}, '2026-01-05', 'UPI Sample Cafe', ${AT}),
      (11, ${SCOPE}, '2026-01-06', 'Sample rent', ${AT});
    INSERT INTO journal_entries (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, comment, source_narration, created_at, updated_at) VALUES
      (101, ${SCOPE}, 10, 2, 100, 0, 'UPI Sample Cafe', 'UPI/050505123456/SAMPLE CAFE/Q0505051@YBL', ${AT}),
      (102, ${SCOPE}, 10, 1, 0, 100, NULL, NULL, ${AT}),
      (111, ${SCOPE}, 11, 2, 50, 0, 'NOPII typed note', NULL, ${AT}),
      (112, ${SCOPE}, 11, 1, 0, 50, NULL, NULL, ${AT});
  `);
  const catalog = createTableCatalog([accounts, journals, journalEntries]);
  const auth = testLedgerAuth();
  const rows = scopedRows(drizzle(sqlite), auth, journals);
  const search = async (term: string) =>
    (
      await rows.page({
        where: buildSearchPredicate(
          catalog.searchPlanFor("journals"),
          term,
          auth,
        ),
      })
    ).data.map((row) => row.id);
  return { search };
}

describe("journals search", () => {
  it("finds a journal by its description, and by its entries' two texts", async () => {
    const { search } = books();
    expect(await search("sample cafe")).toEqual([10]);
    expect(await search("050505123456")).toEqual([10]);
    expect(await search("typed note")).toEqual([11]);
  });
});

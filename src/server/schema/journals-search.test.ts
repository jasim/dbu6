import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  applyMigrations,
  buildSearchPredicate,
  createTableCatalog,
  scopedRows,
  type TableDef,
} from "@sapporta/server";
import { describe, expect, it } from "vitest";
import { testLedgerAuth } from "../modules/ledger-sql/testing.js";
import { dbu6MigrationsDir } from "../paths.js";
import { accounts } from "./accounts.js";
import { draftTransactions } from "./draft-journals.js";
import { journalEntries, journals } from "./journals.js";

const SCOPE = "'workspace', 'user'";
const AT = "'2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'";

/*
 * The Journals and Drafts pages' search. A one-row import's description is
 * its comment once the comment writer reaches it, so the bank's text is
 * found through the entries.
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
    INSERT INTO journal_entries (id, workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, comment, source_narration, source_reference, created_at, updated_at) VALUES
      (101, ${SCOPE}, 10, 2, 100, 0, 'UPI Sample Cafe', 'UPI/050505123456/SAMPLE CAFE/Q0505051@YBL', '0505059876', ${AT}),
      (102, ${SCOPE}, 10, 1, 0, 100, NULL, NULL, NULL, ${AT}),
      (111, ${SCOPE}, 11, 2, 1000, 0, 'NOPII typed note', NULL, NULL, ${AT}),
      (112, ${SCOPE}, 11, 1, 0, 1000, NULL, NULL, NULL, ${AT});
    UPDATE journal_entries SET account_balance_assertion = 25000 WHERE id = 112;
    INSERT INTO draft_transactions (id, workspace_id, scoped_to_user_id, date, account_id, source_narration, withdrawal, deposit, base_account_id, balance_assertion_base_account, created_at, updated_at) VALUES
      (20, ${SCOPE}, '2026-01-07', 2, 'UPI Sample Bakery', 200, 0, 1, 7500, ${AT}),
      (21, ${SCOPE}, '2026-01-08', NULL, 'NEFT NOPII', 0, 300, 1, NULL, ${AT});
  `);
  const catalog = createTableCatalog([
    accounts,
    journals,
    journalEntries,
    draftTransactions,
  ]);
  const auth = testLedgerAuth();
  const db = drizzle(sqlite);
  const searcher = (table: TableDef) => async (term: string) =>
    (
      await scopedRows(db, auth, table).page({
        where: buildSearchPredicate(
          catalog.searchPlanFor(table.sqlName),
          term,
          auth,
        ),
      })
    ).data.map((row) => row.id);
  return {
    search: searcher(journals),
    searchDrafts: searcher(draftTransactions),
  };
}

describe("journals search", () => {
  it("finds a journal by its description, and by its entries' two texts", async () => {
    const { search } = books();
    expect(await search("sample cafe")).toEqual([10]);
    expect(await search("050505123456")).toEqual([10]);
    expect(await search("typed note")).toEqual([11]);
  });

  it("finds a journal by its entries' reference, accounts and amounts", async () => {
    const { search } = books();
    expect(await search("0505059876")).toEqual([10]);
    expect(await search("eating out")).toEqual([11, 10]);
    expect(await search("1,000")).toEqual([11]);
    expect(await search("100")).toEqual([10]);
  });

  it("finds a journal by an entry's balance assertion", async () => {
    const { search } = books();
    expect(await search("25,000")).toEqual([11]);
  });

  it("needs every word, each anywhere in the journal", async () => {
    const { search } = books();
    expect(await search("rent 1000")).toEqual([11]);
    expect(await search("savings cafe")).toEqual([10]);
    expect(await search("rent cafe")).toEqual([]);
  });
});

describe("drafts search", () => {
  it("finds a draft by its amounts and by its balance assertion", async () => {
    const { searchDrafts } = books();
    expect(await searchDrafts("200")).toEqual([20]);
    expect(await searchDrafts("300")).toEqual([21]);
    expect(await searchDrafts("7,500")).toEqual([20]);
  });
});

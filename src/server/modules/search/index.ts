import type Database from "better-sqlite3";
import { and, desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  buildSearchPredicate,
  createTableCatalog,
  type SapportaAuthContext,
  type TableDef,
} from "@sapporta/server";
import { searchWords } from "@sapporta/shared";
import {
  SEARCH_LIMIT,
  type SearchAccount,
  type SearchDraft,
  type SearchJournal,
  type SearchResults,
} from "../../../shared/index.js";
import { accounts, accountsTable } from "../../schema/accounts.js";
import {
  draftTransactions,
  draftTransactionsTable,
} from "../../schema/draft-journals.js";
import {
  journalEntries,
  journals,
  journalsTable,
} from "../../schema/journals.js";
import { allRows } from "../ledger-sql/index.js";

/*
 * Search over the whole books: posted journals, the drafts, and accounts.
 * Which rows match is Sapporta's table search, over each table's
 * `meta.search`, so this finds what the Journals and Drafts grids find for
 * the same words. This module only adds what a result shows.
 */

const catalog = createTableCatalog([
  accounts,
  journals,
  journalEntries,
  draftTransactions,
]);

export function searchBooks(
  db: BetterSQLite3Database,
  sqlite: Database.Database,
  auth: SapportaAuthContext,
  term: string,
): SearchResults {
  const match = (table: TableDef, order: readonly SQLiteColumn[]) =>
    matchingIds(db, auth, table, term, order);
  const journalIds = match(journals, [journalsTable.date, journalsTable.id]);
  const draftIds = match(draftTransactions, [
    draftTransactionsTable.date,
    draftTransactionsTable.id,
  ]);
  const accountIds = match(accounts, [accountsTable.id]);
  return {
    words: searchWords(term),
    journals: journalRows(sqlite, auth, journalIds.ids),
    drafts: draftRows(sqlite, auth, draftIds.ids),
    accounts: accountRows(sqlite, auth, accountIds.ids),
    truncated: {
      journals: journalIds.truncated,
      drafts: draftIds.truncated,
      accounts: accountIds.truncated,
    },
  };
}

/**
 * The ids of `table`'s rows matching `term`, in `order` descending, up to
 * SEARCH_LIMIT; the order's last column is the table's id.
 */
function matchingIds(
  db: BetterSQLite3Database,
  auth: SapportaAuthContext,
  table: TableDef,
  term: string,
  order: readonly SQLiteColumn[],
): { ids: number[]; truncated: boolean } {
  const id = order[order.length - 1]!;
  const rows = db
    .select({ id })
    .from(table.drizzle)
    .where(
      and(
        auth.rowSecurity.forTable(table).ownedRows(),
        buildSearchPredicate(catalog.searchPlanFor(table.sqlName), term, auth),
      ),
    )
    .orderBy(...order.map((column) => desc(column)))
    .limit(SEARCH_LIMIT + 1)
    .all() as { id: number }[];
  return {
    ids: rows.slice(0, SEARCH_LIMIT).map((row) => row.id),
    truncated: rows.length > SEARCH_LIMIT,
  };
}

function journalRows(
  sqlite: Database.Database,
  auth: SapportaAuthContext,
  ids: readonly number[],
): SearchJournal[] {
  if (ids.length === 0) return [];
  const rows = allRows<{
    id: number;
    date: string;
    description: string;
    accounts: string;
    amount: number;
  }>(
    sqlite,
    auth,
    `SELECT j.id, j.date, j.description,
       json_group_array(DISTINCT a.name) AS accounts,
       coalesce(sum(e.debit), 0) AS amount
     FROM scoped_journals j
     JOIN scoped_journal_entries e ON e.journal_id = j.id
     JOIN scoped_accounts a ON a.id = e.account_id
     WHERE j.id IN (SELECT value FROM json_each(@ids))
     GROUP BY j.id
     ORDER BY j.date DESC, j.id DESC`,
    { ids: JSON.stringify(ids) },
  );
  return rows.map((row) => ({
    ...row,
    accounts: JSON.parse(row.accounts) as string[],
  }));
}

function draftRows(
  sqlite: Database.Database,
  auth: SapportaAuthContext,
  ids: readonly number[],
): SearchDraft[] {
  if (ids.length === 0) return [];
  return allRows<SearchDraft>(
    sqlite,
    auth,
    `SELECT d.id, d.date, d.source_narration AS narration, d.comment,
       d.deposit - d.withdrawal AS amount,
       d.base_account_id, base.name AS base_account_name,
       category.name AS account_name
     FROM scoped_draft_transactions d
     LEFT JOIN scoped_accounts base ON base.id = d.base_account_id
     LEFT JOIN scoped_accounts category ON category.id = d.account_id
     WHERE d.id IN (SELECT value FROM json_each(@ids))
     ORDER BY d.date DESC, d.id DESC`,
    { ids: JSON.stringify(ids) },
  );
}

function accountRows(
  sqlite: Database.Database,
  auth: SapportaAuthContext,
  ids: readonly number[],
): SearchAccount[] {
  if (ids.length === 0) return [];
  return allRows<SearchAccount>(
    sqlite,
    auth,
    `SELECT id, name, account_type
     FROM scoped_accounts
     WHERE id IN (SELECT value FROM json_each(@ids))
     ORDER BY name`,
    { ids: JSON.stringify(ids) },
  );
}

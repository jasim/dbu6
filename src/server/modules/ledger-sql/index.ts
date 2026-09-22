import type Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SapportaAuthContext } from "@sapporta/server";
import { accounts, accountsTable } from "../../schema/accounts.js";
import {
  draftTransactions,
  draftTransactionsTable,
} from "../../schema/draft-journals.js";
import {
  journalEntries,
  journalEntriesTable,
  journals,
  journalsTable,
} from "../../schema/journals.js";

// Row scoping for the ledger. Drizzle queries scope their rows through the
// auth every store takes. Raw SQL reads the ledger only through the
// `scoped_*` relations that `allRows` and `oneRow` put in front of it, each
// built from the same Sapporta row security.

/** What a ledger store needs of the request's auth: its row security. */
export type LedgerAuth = Pick<SapportaAuthContext, "rowSecurity">;

/**
 * What a workflow reads and writes the ledger through: Drizzle for rows, the
 * SQLite connection for the raw queries below, and the request's auth.
 */
export interface Ledger {
  db: BetterSQLite3Database;
  sqlite: Database.Database;
  auth: LedgerAuth;
}

const dialect = new SQLiteSyncDialect();

/**
 * `WITH RECURSIVE scoped_accounts AS (…), …`: one relation per ledger table,
 * holding only the rows `auth` may see, with the values its predicates bind.
 */
function scopedLedger(auth: LedgerAuth): { sql: string; params: unknown[] } {
  const relations = [
    sql`scoped_accounts AS (
  SELECT * FROM ${accountsTable}
  WHERE ${auth.rowSecurity.forTable(accounts).ownedRows()}
)`,
    sql`scoped_journals AS (
  SELECT * FROM ${journalsTable}
  WHERE ${auth.rowSecurity.forTable(journals).ownedRows()}
)`,
    sql`scoped_journal_entries AS (
  SELECT * FROM ${journalEntriesTable}
  WHERE ${auth.rowSecurity.forTable(journalEntries).ownedRows()}
)`,
    sql`scoped_draft_transactions AS (
  SELECT * FROM ${draftTransactionsTable}
  WHERE ${auth.rowSecurity.forTable(draftTransactions).ownedRows()}
)`,
  ];
  return dialect.sqlToQuery(
    sql`WITH RECURSIVE\n${sql.join(relations, sql`,\n`)}`,
  );
}

/*
 * `query` continues the scoped relations: a statement that reads them, or
 * more CTEs starting with a comma. It binds its own values by name
 * (`@asOfDate`); the positional ones belong to the scoped relations.
 */

export function allRows<T>(
  sqlite: Database.Database,
  auth: LedgerAuth,
  query: string,
  params: Record<string, unknown> = {},
): T[] {
  const scoped = scopedLedger(auth);
  return sqlite
    .prepare(`${scoped.sql}\n${query}`)
    .all(...scoped.params, params) as T[];
}

export function oneRow<T>(
  sqlite: Database.Database,
  auth: LedgerAuth,
  query: string,
  params: Record<string, unknown> = {},
): T | null {
  const scoped = scopedLedger(auth);
  const row = sqlite
    .prepare(`${scoped.sql}\n${query}`)
    .get(...scoped.params, params) as T | undefined;
  return row ?? null;
}

/**
 * The ledger as a report reads it: the `scoped_*` relations of one user's
 * books, and nothing that writes. A report's query function takes this, so
 * the same function runs behind a route and in a test.
 */
export interface ReportLedger {
  /** Every row of a query over the `scoped_*` relations; see `allRows`. */
  all<T>(query: string, params?: Record<string, unknown>): T[];
  /** The first row of such a query, or `null` when there is none. */
  one<T>(query: string, params?: Record<string, unknown>): T | null;
}

/**
 * `auth`'s rows of the ledger in `sqlite`, for reading only: a statement
 * that would write throws before it runs. The check is SQLite's own, so a
 * `WITH … INSERT` does not slip past it.
 */
export function readOnlyLedger(
  sqlite: Database.Database,
  auth: LedgerAuth,
): ReportLedger {
  const prepare = (query: string) => {
    const scoped = scopedLedger(auth);
    const statement = sqlite.prepare(`${scoped.sql}\n${query}`);
    if (!statement.readonly) {
      throw new Error(
        "A report reads the ledger; this statement writes to it.",
      );
    }
    return { statement, scopeParams: scoped.params };
  };
  return {
    all<T>(query: string, params: Record<string, unknown> = {}) {
      const { statement, scopeParams } = prepare(query);
      return statement.all(...scopeParams, params) as T[];
    },
    one<T>(query: string, params: Record<string, unknown> = {}) {
      const { statement, scopeParams } = prepare(query);
      return (statement.get(...scopeParams, params) as T | undefined) ?? null;
    },
  };
}

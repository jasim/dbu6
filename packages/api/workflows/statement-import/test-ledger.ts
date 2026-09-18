import Database from "better-sqlite3";
import type { Ledger } from "../../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../../modules/ledger-sql/testing.js";

/**
 * A ledger for the statement-import tests. Its Drizzle rows are a stub that
 * holds nothing and writes nowhere; its raw queries read an in-memory SQLite
 * that holds `checkpoint`, when given, as the account's one posted balance
 * assertion.
 */
export function testImportLedger(checkpoint?: {
  account: string;
  date: string;
  balance: number;
}): Ledger {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE accounts (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, name TEXT
    );
    CREATE TABLE journals (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, date TEXT
    );
    CREATE TABLE journal_entries (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT, journal_id INTEGER,
      account_id INTEGER, account_balance_assertion REAL
    );
    CREATE TABLE draft_transactions (
      id INTEGER, workspace_id TEXT, scoped_to_user_id TEXT
    );
  `);
  if (checkpoint) {
    sqlite
      .prepare("INSERT INTO accounts VALUES (1, 'workspace', 'user', @account)")
      .run(checkpoint);
    sqlite
      .prepare("INSERT INTO journals VALUES (1, 'workspace', 'user', @date)")
      .run(checkpoint);
    sqlite
      .prepare(
        "INSERT INTO journal_entries VALUES (1, 'workspace', 'user', 1, 1, @balance)",
      )
      .run(checkpoint);
  }
  return { db: emptyDb(), sqlite, auth: testLedgerAuth() };
}

function emptyDb(): any {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    all: () => [],
    get: () => undefined,
    transaction: (run: (tx: any) => unknown) => run(chain),
  };
  return chain;
}

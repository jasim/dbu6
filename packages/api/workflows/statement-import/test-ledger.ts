import Database from "better-sqlite3";
import { accountsTable } from "../../schema/accounts.js";
import type { Ledger } from "../../modules/ledger-sql/index.js";
import { testLedgerAuth } from "../../modules/ledger-sql/testing.js";

/**
 * A ledger for the statement-import tests, holding one account, `account`.
 * Its Drizzle rows are a stub that finds that account and nothing else, and
 * writes nowhere; its raw queries read an in-memory SQLite that holds the
 * account and, when given, `checkpoint` as its one posted balance assertion.
 */
export function testImportLedger(
  account: string,
  checkpoint?: { date: string; balance: number },
): Ledger {
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
  sqlite
    .prepare("INSERT INTO accounts VALUES (1, 'workspace', 'user', ?)")
    .run(account);
  if (checkpoint) {
    sqlite
      .prepare("INSERT INTO journals VALUES (1, 'workspace', 'user', @date)")
      .run(checkpoint);
    sqlite
      .prepare(
        "INSERT INTO journal_entries VALUES (1, 'workspace', 'user', 1, 1, @balance)",
      )
      .run(checkpoint);
  }
  return {
    db: stubDb({ id: 1, name: account, parent_id: null }),
    sqlite,
    auth: testLedgerAuth(),
  };
}

function stubDb(account: object): any {
  const rows = (table: unknown) => (table === accountsTable ? [account] : []);
  const query = (table: unknown): any => ({
    innerJoin: () => query(table),
    where: () => query(table),
    orderBy: () => query(table),
    limit: () => query(table),
    all: () => rows(table),
    get: () => rows(table)[0],
  });
  const db: any = {
    select: () => ({ from: (table: unknown) => query(table) }),
    transaction: (run: (tx: any) => unknown) => run(db),
  };
  return db;
}

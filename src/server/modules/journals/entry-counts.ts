import type Database from "better-sqlite3";
import { allRows, type LedgerAuth } from "../ledger-sql/index.js";

/** How many posted journal entries sit on each account that has any. */
export function countEntriesByAccount(
  sqlite: Database.Database,
  auth: LedgerAuth,
): Map<number, number> {
  return new Map(
    allRows<{ account_id: number; entries: number }>(
      sqlite,
      auth,
      `SELECT account_id, COUNT(*) AS entries
       FROM scoped_journal_entries GROUP BY account_id`,
    ).map((row) => [row.account_id, row.entries]),
  );
}

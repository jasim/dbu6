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

/**
 * How many posted journal entries on each account are its own: every entry
 * but one another account's import posted with this account as its
 * category, as a card payment from the bank's statement is. An import keys
 * the category line of each row it posts and never its own account's line
 * (see `loadPostedRowsOn`), so a keyed line on the account is another
 * statement's row; its own imports' lines, its opening entry and what was
 * entered by hand carry no key.
 */
export function countOwnEntriesByAccount(
  sqlite: Database.Database,
  auth: LedgerAuth,
): Map<number, number> {
  return new Map(
    allRows<{ account_id: number; entries: number }>(
      sqlite,
      auth,
      `SELECT account_id, COUNT(*) AS entries
       FROM scoped_journal_entries
       WHERE source_transaction_key IS NULL
       GROUP BY account_id`,
    ).map((row) => [row.account_id, row.entries]),
  );
}

import type Database from "better-sqlite3";
import { allRows, type LedgerAuth } from "../ledger-sql/index.js";

/**
 * How many drafts touch each account that any touches: drafts from its own
 * statements (`base_account_id`) and drafts categorized to it
 * (`account_id`). A draft whose two sides are one account counts once.
 */
export function countDraftsByAccount(
  sqlite: Database.Database,
  auth: LedgerAuth,
): Map<number, number> {
  return new Map(
    allRows<{ account_id: number; drafts: number }>(
      sqlite,
      auth,
      `, touched AS (
         SELECT id, base_account_id AS account_id FROM scoped_draft_transactions
         WHERE base_account_id IS NOT NULL
         UNION
         SELECT id, account_id FROM scoped_draft_transactions
         WHERE account_id IS NOT NULL
       )
       SELECT account_id, COUNT(*) AS drafts FROM touched GROUP BY account_id`,
    ).map((row) => [row.account_id, row.drafts]),
  );
}

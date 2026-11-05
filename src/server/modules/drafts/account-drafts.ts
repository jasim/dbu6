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

/**
 * How many drafts each account's own statements hold (`base_account_id`),
 * for every account with any: the `drafts` of its draft status.
 */
export function countDraftsByBaseAccount(
  sqlite: Database.Database,
  auth: LedgerAuth,
): Map<number, number> {
  return new Map(
    allRows<{ account_id: number; drafts: number }>(
      sqlite,
      auth,
      `SELECT base_account_id AS account_id, COUNT(*) AS drafts
       FROM scoped_draft_transactions
       WHERE base_account_id IS NOT NULL
       GROUP BY base_account_id`,
    ).map((row) => [row.account_id, row.drafts]),
  );
}

// Every posted entry and draft as an amount on one account and day, debit
// positive: a draft is money in on its statement's account and the other
// way round on the account it is categorized to.
const DATED_AMOUNTS = `, amounts AS (
  SELECT je.account_id, j.date, je.debit - je.credit AS amount
  FROM scoped_journal_entries je
  JOIN scoped_journals j ON j.id = je.journal_id
  UNION ALL
  SELECT base_account_id, date, deposit - withdrawal FROM scoped_draft_transactions
  WHERE base_account_id IS NOT NULL
  UNION ALL
  SELECT account_id, date, withdrawal - deposit FROM scoped_draft_transactions
  WHERE account_id IS NOT NULL
)`;

/** One day's movement on an account. */
export type DayAmount = { date: string; amount: number };

/**
 * Each day's movement on each account with any, posted entries plus drafts,
 * debit positive, oldest first.
 */
export function loadDailyAmountsWithDrafts(
  sqlite: Database.Database,
  auth: LedgerAuth,
): Map<number, DayAmount[]> {
  const days = new Map<number, DayAmount[]>();
  for (const row of allRows<DayAmount & { account_id: number }>(
    sqlite,
    auth,
    `${DATED_AMOUNTS}
     SELECT account_id, date, SUM(amount) AS amount FROM amounts
     GROUP BY account_id, date ORDER BY account_id, date`,
  )) {
    const list = days.get(row.account_id) ?? [];
    list.push({ date: row.date, amount: row.amount });
    days.set(row.account_id, list);
  }
  return days;
}

/**
 * Each account's balance once its drafts are posted: its posted entries
 * plus its drafts, debit positive, for every account with either. A draft
 * lands on its statement's account (`base_account_id`), money in as a
 * debit, and on the account it is categorized to (`account_id`), the other
 * way round; an uncategorized draft lands on its statement's account alone.
 */
export function loadBalancesWithDrafts(
  sqlite: Database.Database,
  auth: LedgerAuth,
): Map<number, number> {
  return new Map(
    allRows<{ account_id: number; balance: number }>(
      sqlite,
      auth,
      `${DATED_AMOUNTS}
       SELECT account_id, SUM(amount) AS balance FROM amounts GROUP BY account_id`,
    ).map((row) => [row.account_id, row.balance]),
  );
}

/**
 * The accounts one statement's drafts land on once posted: the statement's
 * own account and every account a draft of it is categorized to.
 */
export function loadAccountsDraftsLandOn(
  sqlite: Database.Database,
  auth: LedgerAuth,
  baseAccountId: number,
): Set<number> {
  return new Set(
    allRows<{ account_id: number }>(
      sqlite,
      auth,
      `SELECT DISTINCT account_id FROM scoped_draft_transactions
       WHERE base_account_id = @baseAccountId AND account_id IS NOT NULL`,
      { baseAccountId },
    )
      .map((row) => row.account_id)
      .concat(baseAccountId),
  );
}

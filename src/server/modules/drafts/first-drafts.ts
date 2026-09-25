import type Database from "better-sqlite3";
import { draftOrderSql } from "../reconciliation/index.js";
import { allRows, type LedgerAuth } from "../ledger-sql/index.js";

/*
 * Where an account's drafts begin. Posted, a draft lands on two accounts:
 * its statement's (`base_account_id`) and the one it is categorized to
 * (`account_id`), so each side has a first date here. An account's first
 * balance check is the first draft from its own statements, in the order
 * the check adds them up, that carries a statement balance; that
 * balance minus the drafts up to and including it is what the account held
 * before its first draft, as far as the drafts alone can tell. With nothing
 * posted on the account, it is the opening balance the checks are missing.
 */

export type FirstDrafts = {
  account_id: number;
  first_date: string;
  /** Null when no draft carries a statement balance. */
  implied_opening: number | null;
};

/** Each account with drafts from its own statements, by id. */
export function loadFirstDrafts(
  sqlite: Database.Database,
  auth: LedgerAuth,
): Map<number, FirstDrafts> {
  const rows = allRows<FirstDrafts>(
    sqlite,
    auth,
    `
    , ordered AS (
      SELECT
        dt.base_account_id AS account_id,
        dt.date,
        dt.balance_assertion_base_account AS assertion,
        SUM(dt.deposit - dt.withdrawal) OVER (
          PARTITION BY dt.base_account_id ORDER BY ${draftOrderSql("dt")}
          ROWS UNBOUNDED PRECEDING
        ) AS drafts_total,
        ROW_NUMBER() OVER (
          PARTITION BY dt.base_account_id ORDER BY ${draftOrderSql("dt")}
        ) AS position
      FROM scoped_draft_transactions dt
      WHERE dt.base_account_id IS NOT NULL
    )
    SELECT
      o.account_id,
      MIN(o.date) AS first_date,
      (
        SELECT c.assertion - c.drafts_total
        FROM ordered c
        WHERE c.account_id = o.account_id AND c.assertion IS NOT NULL
        ORDER BY c.position
        LIMIT 1
      ) AS implied_opening
    FROM ordered o
    GROUP BY o.account_id`,
  );
  return new Map(
    rows.map((row) => [
      row.account_id,
      {
        ...row,
        implied_opening:
          row.implied_opening === null
            ? null
            : Number(row.implied_opening.toFixed(2)),
      },
    ]),
  );
}

/**
 * The day of each account's first draft categorized to it (`account_id`),
 * by id: a row on another account's statement that, once posted, is on this
 * account too. `loadFirstDrafts` has the drafts from its own statements.
 */
export function loadFirstCategorizedDraftDates(
  sqlite: Database.Database,
  auth: LedgerAuth,
): Map<number, string> {
  return new Map(
    allRows<{ account_id: number; first_date: string }>(
      sqlite,
      auth,
      `SELECT account_id, MIN(date) AS first_date
       FROM scoped_draft_transactions
       WHERE account_id IS NOT NULL
       GROUP BY account_id`,
    ).map((row) => [row.account_id, row.first_date]),
  );
}

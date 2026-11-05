import type Database from "better-sqlite3";
import { cents, OPENING_JOURNALS } from "../journals/index.js";
import { allRows, type LedgerAuth } from "../ledger-sql/index.js";
import { assertionFailsSql, draftOrderSql } from "./balance-check.js";

// Shared SQL for draft assertion reporting and the posting gate. An account's
// running balance adds its posted entries, the drafts of other accounts'
// statements categorized to it, and its own drafts. On the same date they go
// in that order: journals by id, then the other accounts' drafts, then its
// own in `draftOrderSql`, numbered here so the window can order them.
//
// Another account's draft counts on the side it will post to: its
// withdrawal is a debit here. It sits where its journal will sit once that
// account's drafts are added, ahead of this account's own drafts on its
// date, so a check that passes now still passes after that post, and a
// transfer both statements print fails here before either is posted. Two
// accounts whose last journals of a day each go to the other can't both
// sit there; the posting gate refuses that post rather than write it.
//
// The posting gate narrows the other accounts' drafts to those of the
// accounts it adds together (`OtherDrafts`): a draft goes into the books only
// with its own account, so a check that counts it can pass only when both go
// in. Review, the reports and the implied openings count every account's.
/**
 * A draft of another account's statement that counts on the account it is
 * categorized to (`dt.account_id`), as the running balance adds it.
 */
export function otherStatementDraftSql(alias: string): string {
  return `${alias}.base_account_id IS NOT NULL
    AND ${alias}.account_id IS NOT NULL
    AND ${alias}.account_id <> ${alias}.base_account_id`;
}

export const BASE_ACCOUNT_ACTIVITY_ORDER =
  "activity_date, source_rank, ord_journal, ord_entry";

/**
 * Whose drafts of other statements count on an account's running balance:
 * every account's, or only those of the accounts listed by id.
 */
export type OtherDrafts = "every account" | readonly number[];

/**
 * The running balance CTEs, counting other statements' drafts from
 * `otherDrafts` only. `baseAccountRunningBalanceCtes` counts every account's.
 */
export function runningBalanceCtes(otherDrafts: OtherDrafts): string {
  return `
, base_account_activity AS (
  SELECT
    je.account_id AS account_id,
    j.date AS activity_date,
    j.id AS ord_journal,
    je.id AS ord_entry,
    0 AS source_rank,
    'journal' AS source,
    je.debit - je.credit AS delta,
    NULL AS draft_id,
    je.account_balance_assertion AS assertion
  FROM scoped_journal_entries je
  JOIN scoped_journals j ON j.id = je.journal_id
  UNION ALL
  SELECT
    dt.account_id AS account_id,
    dt.date AS activity_date,
    0 AS ord_journal,
    ROW_NUMBER() OVER (
      PARTITION BY dt.account_id ORDER BY ${draftOrderSql("dt")}
    ) AS ord_entry,
    1 AS source_rank,
    'other_draft' AS source,
    dt.withdrawal - dt.deposit AS delta,
    dt.id AS draft_id,
    NULL AS assertion
  FROM scoped_draft_transactions dt
  WHERE ${otherStatementDraftSql("dt")}${otherDraftsCondition(otherDrafts)}
  UNION ALL
  SELECT
    dt.base_account_id AS account_id,
    dt.date AS activity_date,
    0 AS ord_journal,
    ROW_NUMBER() OVER (
      PARTITION BY dt.base_account_id ORDER BY ${draftOrderSql("dt")}
    ) AS ord_entry,
    2 AS source_rank,
    'draft' AS source,
    dt.deposit - dt.withdrawal AS delta,
    dt.id AS draft_id,
    dt.balance_assertion_base_account AS assertion
  FROM scoped_draft_transactions dt
  WHERE dt.base_account_id IS NOT NULL
),
base_account_running AS (
  SELECT
    activity.account_id,
    activity_date,
    source,
    draft_id,
    assertion,
    SUM(delta) OVER (
      PARTITION BY activity.account_id
      ORDER BY ${BASE_ACCOUNT_ACTIVITY_ORDER}
      ROWS UNBOUNDED PRECEDING
    ) AS running_balance
  FROM base_account_activity activity
)`;
}

export const baseAccountRunningBalanceCtes =
  runningBalanceCtes("every account");

// The ids go into the SQL as written, so each must be an integer.
function otherDraftsCondition(otherDrafts: OtherDrafts): string {
  if (otherDrafts === "every account") return "";
  for (const id of otherDrafts) {
    if (!Number.isSafeInteger(id)) throw new Error(`Not an account id: ${id}`);
  }
  return `
    AND dt.base_account_id IN (${otherDrafts.join(", ")})`;
}

/**
 * Each account's balance once its drafts are posted, by id, for every
 * account with a posted entry or a draft: the running balance's activity
 * added up, other statements' drafts on the side they will post to.
 */
export function loadBalancesWithDrafts(
  sqlite: Database.Database,
  auth: LedgerAuth,
): Map<number, number> {
  return new Map(
    allRows<{ account_id: number; balance: number }>(
      sqlite,
      auth,
      `${baseAccountRunningBalanceCtes}
       SELECT account_id, SUM(delta) AS balance FROM base_account_activity
       GROUP BY account_id`,
    ).map((row) => [row.account_id, cents(row.balance)]),
  );
}

/**
 * What moved on one account up to and including `date`, posted entries and
 * drafts, as its running balance adds them up: a balance known at the end
 * of that day, less this, is what the account held before it all.
 */
export function loadMovementThrough(
  sqlite: Database.Database,
  auth: LedgerAuth,
  accountId: number,
  date: string,
): number {
  const [row] = allRows<{ moved: number | null }>(
    sqlite,
    auth,
    `${baseAccountRunningBalanceCtes}
     SELECT SUM(delta) AS moved FROM base_account_activity
     WHERE account_id = @accountId AND activity_date <= @date`,
    { accountId, date },
  );
  return cents(row?.moved ?? 0);
}

/**
 * The opening balance each account's first balance check implies, by id: the
 * check's balance less everything added up to and including its row, posted
 * entries and drafts in `BASE_ACCOUNT_ACTIVITY_ORDER`. The account's opening
 * journal is left out, both from what is added up and as a check, since it
 * asserts the opening it records. An account with no check is not in the map.
 */
export function loadImpliedOpenings(
  sqlite: Database.Database,
  auth: LedgerAuth,
): Map<number, number> {
  const rows = allRows<{ account_id: number; implied: number }>(
    sqlite,
    auth,
    `${OPENING_JOURNALS}
    ${baseAccountRunningBalanceCtes}
    , beside_opening AS (
      SELECT
        activity.account_id,
        activity.assertion,
        SUM(activity.delta) OVER (
          PARTITION BY activity.account_id
          ORDER BY ${BASE_ACCOUNT_ACTIVITY_ORDER}
          ROWS UNBOUNDED PRECEDING
        ) AS running,
        ROW_NUMBER() OVER (
          PARTITION BY activity.account_id, activity.assertion IS NULL
          ORDER BY ${BASE_ACCOUNT_ACTIVITY_ORDER}
        ) AS position
      FROM base_account_activity activity
      LEFT JOIN opening_journals o
        ON activity.source = 'journal'
        AND o.account_id = activity.account_id
        AND o.journal_id = activity.ord_journal
      WHERE o.journal_id IS NULL
    )
    SELECT account_id, assertion - running AS implied
    FROM beside_opening
    WHERE assertion IS NOT NULL AND position = 1`,
  );
  return new Map(rows.map((row) => [row.account_id, cents(row.implied)]));
}

/**
 * One row of an account's running balance, as the balance checks add it up:
 * a posted entry, another statement's draft categorized to the account, or
 * one of its own drafts.
 */
export interface AccountActivityRow {
  date: string;
  kind: "entry" | "other draft" | "draft";
  /** The entry's or the draft's id. */
  id: number;
  /** The entry's journal; null for a draft. */
  journal_id: number | null;
  /** Whose statement another statement's draft came from; null otherwise. */
  other_account_id: number | null;
  /** What the row adds to the account's balance. */
  amount: number;
  /** The statement's balance the row carries, or null. */
  statement_balance: number | null;
  /** The running balance after the row. */
  running: number;
  /** Running balance minus the statement's; null without one. */
  diff: number | null;
  source_narration: string | null;
  comment: string | null;
  source_transaction_key: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The account's running balance, a row per entry and draft in the order the
 * checks add them up (`BASE_ACCOUNT_ACTIVITY_ORDER`), from `from` to `to`
 * (both optional, inclusive). The running total starts from the account's
 * first row whatever the dates. `postedOnly` counts posted entries alone,
 * as the books' own checks do; otherwise every account's drafts count, as
 * Review's do.
 */
export function loadAccountActivity(
  sqlite: Database.Database,
  auth: LedgerAuth,
  accountId: number,
  options: { from?: string; to?: string; postedOnly?: boolean } = {},
): AccountActivityRow[] {
  const rows = allRows<Omit<AccountActivityRow, "kind"> & { source: string }>(
    sqlite,
    auth,
    `${baseAccountRunningBalanceCtes}
    , account_activity AS (
      SELECT
        activity.*,
        SUM(activity.delta) OVER (
          ORDER BY ${BASE_ACCOUNT_ACTIVITY_ORDER}
          ROWS UNBOUNDED PRECEDING
        ) AS running
      FROM base_account_activity activity
      WHERE activity.account_id = @accountId
        AND (@postedOnly = 0 OR activity.source = 'journal')
    )
    SELECT
      a.activity_date AS date,
      a.source,
      COALESCE(je.id, d.id) AS id,
      je.journal_id,
      CASE WHEN a.source = 'other_draft' THEN d.base_account_id END
        AS other_account_id,
      a.delta AS amount,
      a.assertion AS statement_balance,
      a.running,
      CASE WHEN a.assertion IS NOT NULL THEN a.running - a.assertion END
        AS diff,
      COALESCE(je.source_narration, d.source_narration) AS source_narration,
      COALESCE(je.comment, d.comment) AS comment,
      COALESCE(je.source_transaction_key, d.source_transaction_key)
        AS source_transaction_key,
      COALESCE(je.created_at, d.created_at) AS created_at,
      COALESCE(je.updated_at, d.updated_at) AS updated_at
    FROM account_activity a
    LEFT JOIN scoped_journal_entries je
      ON a.source = 'journal' AND je.id = a.ord_entry
    LEFT JOIN scoped_draft_transactions d
      ON a.source <> 'journal' AND d.id = a.draft_id
    WHERE (@from IS NULL OR a.activity_date >= @from)
      AND (@to IS NULL OR a.activity_date <= @to)
    ORDER BY ${BASE_ACCOUNT_ACTIVITY_ORDER.split(", ")
      .map((column) => `a.${column}`)
      .join(", ")}`,
    {
      accountId,
      postedOnly: options.postedOnly ? 1 : 0,
      from: options.from ?? null,
      to: options.to ?? null,
    },
  );
  return rows.map(({ source, ...row }) => ({
    ...row,
    kind: ACTIVITY_KINDS[source],
    amount: cents(row.amount),
    running: cents(row.running),
    diff: row.diff === null ? null : cents(row.diff),
  }));
}

const ACTIVITY_KINDS: Record<string, AccountActivityRow["kind"]> = {
  journal: "entry",
  other_draft: "other draft",
  draft: "draft",
};

export const failingDraftAssertionsSelect = `
SELECT
  r.account_id,
  r.activity_date AS date,
  r.draft_id,
  r.running_balance,
  r.assertion,
  r.running_balance - r.assertion AS diff
FROM base_account_running r
WHERE r.source = 'draft'
  AND r.assertion IS NOT NULL
  AND ${assertionFailsSql("r.running_balance", "r.assertion")}`;

/*
 * `posted_assertion_failures`: each balance assertion in the books, posted
 * entries only, that the account's running balance misses there. The running
 * balance is summed only for accounts that carry an assertion, the statement
 * accounts, which leaves out every categorized account. Within a day, entries
 * go in journal and entry id order, as the posting gate added them. The
 * statement import relies on that order to know which of a day's rows a
 * balance check counted (`loadPostedRowsOn`, checkpoint-day.md).
 */
export const postedAssertionFailuresCtes = `
, asserted_accounts AS (
  SELECT DISTINCT account_id
  FROM scoped_journal_entries
  WHERE account_balance_assertion IS NOT NULL
),
posted_running AS (
  SELECT
    je.id AS entry_id,
    je.account_id,
    je.journal_id,
    j.date,
    je.account_balance_assertion AS assertion,
    SUM(je.debit - je.credit) OVER (
      PARTITION BY je.account_id
      ORDER BY j.date, j.id, je.id
      ROWS UNBOUNDED PRECEDING
    ) AS running_balance
  FROM scoped_journal_entries je
  JOIN scoped_journals j ON j.id = je.journal_id
  WHERE je.account_id IN (SELECT account_id FROM asserted_accounts)
),
posted_assertion_failures AS (
  SELECT
    entry_id,
    account_id,
    journal_id,
    date,
    running_balance,
    assertion,
    running_balance - assertion AS diff
  FROM posted_running
  WHERE assertion IS NOT NULL
    AND ${assertionFailsSql("running_balance", "assertion")}
)`;

/**
 * How many posted balance assertions each account's books miss, by id; of
 * the one account with id `accountId` when given.
 */
export function countPostedAssertionFailures(
  sqlite: Database.Database,
  auth: LedgerAuth,
  filter: { accountId?: number } = {},
): Map<number, number> {
  const rows = allRows<{ account_id: number; failures: number }>(
    sqlite,
    auth,
    `${postedAssertionFailuresCtes}
    SELECT account_id, COUNT(*) AS failures
    FROM posted_assertion_failures
    WHERE @accountId IS NULL OR account_id = @accountId
    GROUP BY account_id`,
    { accountId: filter.accountId ?? null },
  );
  return new Map(rows.map((row) => [row.account_id, row.failures]));
}

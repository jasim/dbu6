import { assertionFailsSql, draftOrderSql } from "./balance-check.js";

// Shared SQL for draft assertion reporting and the posting gate. Journal rows
// precede draft rows on the same date; journals go by id, and drafts in
// `draftOrderSql`, numbered here so the window can order them.
export const BASE_ACCOUNT_ACTIVITY_ORDER =
  "activity_date, source_rank, ord_journal, ord_entry";

export const baseAccountRunningBalanceCtes = `
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
    NULL AS assertion
  FROM scoped_journal_entries je
  JOIN scoped_journals j ON j.id = je.journal_id
  UNION ALL
  SELECT
    dt.base_account_id AS account_id,
    dt.date AS activity_date,
    0 AS ord_journal,
    ROW_NUMBER() OVER (
      PARTITION BY dt.base_account_id ORDER BY ${draftOrderSql("dt")}
    ) AS ord_entry,
    1 AS source_rank,
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

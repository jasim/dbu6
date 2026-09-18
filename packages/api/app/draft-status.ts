import type Database from "better-sqlite3";
import {
  NO_DRAFTS,
  type DatedBalance,
  type DateSpan,
  type DraftCounts,
} from "dbu6-shared";
import {
  duplicateDraftRowsSql,
  duplicateJournalEntryRowsSql,
  findDuplicateDiagnostics,
  type DuplicateDiagnostic,
  type DuplicateDraftSourceRow,
  type DuplicateJournalEntrySourceRow,
} from "../modules/reconciliation/duplicate-diagnostics.js";
import {
  baseAccountRunningBalanceCtes,
  failingDraftAssertionsSelect,
} from "../modules/reconciliation/running-balance.js";
import {
  allRows,
  type ScopeParams,
  ledgerCtes,
} from "../modules/ledger-sql/index.js";

/*
 * What an account's drafts hold (PLAN.md §11 P3). Home, Review, the posting
 * gate and the two draft reports all read these queries. What blocks posting
 * is decided from the counts by `postingChecks` in dbu6-shared, which the gate
 * and the screens share, so a tick on Review and a refusal from the gate
 * cannot disagree.
 *
 * Counts are the reports' rows: a draft that matches two others is two
 * possible duplicates.
 */

/** A draft carrying a statement balance the running balance doesn't reach. */
export type FailingCheck = {
  account_id: number;
  date: string;
  draft_id: number;
  running_balance: number;
  assertion: number;
  diff: number;
};

export interface DraftAccountStatus {
  account_id: number;
  drafts: number;
  /** Drafts with no category (`account_id` is null). */
  uncategorised: number;
  /** The drafts' first and last dates. */
  draft_span: DateSpan;
  /** Drafts carrying a balance the statement printed. */
  balance_checks: number;
  /** The last of those, by date then id. */
  closing: DatedBalance | null;
  failing: FailingCheck[];
  duplicates: DuplicateDiagnostic[];
}

/** Narrows every query to one base account. */
export interface DraftStatusFilter {
  accountId?: number;
}

type DraftCountRow = {
  account_id: number;
  drafts: number;
  uncategorised: number;
  first_date: string;
  last_date: string;
  balance_checks: number;
};

type ClosingRow = { account_id: number; date: string; balance: number };

/** Every account with drafts, keyed by its id. */
export function loadDraftStatus(
  sqlite: Database.Database,
  scope: ScopeParams,
  filter: DraftStatusFilter = {},
): Map<number, DraftAccountStatus> {
  const params = withAccount(scope, filter);
  const counts = allRows<DraftCountRow>(
    sqlite,
    `${ledgerCtes}
    SELECT
      base_account_id AS account_id,
      COUNT(*) AS drafts,
      SUM(CASE WHEN account_id IS NULL THEN 1 ELSE 0 END) AS uncategorised,
      MIN(date) AS first_date,
      MAX(date) AS last_date,
      SUM(CASE WHEN balance_assertion_base_account IS NOT NULL THEN 1 ELSE 0 END)
        AS balance_checks
    FROM scoped_draft_transactions
    WHERE base_account_id IS NOT NULL${accountCondition(filter, "base_account_id")}
    GROUP BY base_account_id`,
    params,
  );
  const closings = allRows<ClosingRow>(
    sqlite,
    `${ledgerCtes}
    SELECT account_id, date, balance
    FROM (
      SELECT
        base_account_id AS account_id,
        date,
        balance_assertion_base_account AS balance,
        ROW_NUMBER() OVER (
          PARTITION BY base_account_id ORDER BY date DESC, id DESC
        ) AS position
      FROM scoped_draft_transactions
      WHERE base_account_id IS NOT NULL
        AND balance_assertion_base_account IS NOT NULL${accountCondition(filter, "base_account_id")}
    )
    WHERE position = 1`,
    params,
  );
  const closingById = new Map(closings.map((row) => [row.account_id, row]));
  const failingById = groupBy(
    findFailingChecks(sqlite, scope, filter),
    (row) => row.account_id,
  );
  const duplicatesById = groupBy(
    findDraftDuplicates(sqlite, scope, filter),
    (row) => row.base_account_id,
  );

  return new Map(
    counts.map((row) => {
      const closing = closingById.get(row.account_id);
      return [
        row.account_id,
        {
          account_id: row.account_id,
          drafts: row.drafts,
          uncategorised: row.uncategorised,
          draft_span: { first_date: row.first_date, last_date: row.last_date },
          balance_checks: row.balance_checks,
          closing: closing
            ? { date: closing.date, balance: closing.balance }
            : null,
          failing: failingById.get(row.account_id) ?? [],
          duplicates: duplicatesById.get(row.account_id) ?? [],
        },
      ];
    }),
  );
}

/** An account's counts, as the contracts carry them; none without drafts. */
export function draftCounts(
  status: DraftAccountStatus | undefined,
): DraftCounts {
  if (status === undefined) return NO_DRAFTS;
  return {
    drafts: status.drafts,
    uncategorised: status.uncategorised,
    duplicates: status.duplicates.length,
    balance_checks: status.balance_checks,
    failing_checks: status.failing.length,
  };
}

/** The failing draft balance checks, by account, date and draft. */
export function findFailingChecks(
  sqlite: Database.Database,
  scope: ScopeParams,
  filter: DraftStatusFilter = {},
): FailingCheck[] {
  return allRows<FailingCheck>(
    sqlite,
    `${ledgerCtes}${baseAccountRunningBalanceCtes}
    SELECT r.account_id, r.date, r.draft_id, r.running_balance, r.assertion, r.diff
    FROM (${failingDraftAssertionsSelect}) r
    ${accountCondition(filter, "r.account_id", "WHERE")}
    ORDER BY r.account_id, r.date, r.draft_id`,
    withAccount(scope, filter),
  );
}

/**
 * Drafts that look like another draft or a posted entry. A draft only ever
 * matches drafts of its own account, and posted entries of any, so narrowing
 * the drafts to one account leaves that account's rows unchanged.
 */
export function findDraftDuplicates(
  sqlite: Database.Database,
  scope: ScopeParams,
  filter: DraftStatusFilter = {},
): DuplicateDiagnostic[] {
  const drafts = allRows<DuplicateDraftSourceRow>(
    sqlite,
    `${ledgerCtes}${duplicateDraftRowsSql}${accountCondition(filter, "dt.base_account_id")}`,
    withAccount(scope, filter),
  );
  if (drafts.length === 0) return [];
  const journalEntries = allRows<DuplicateJournalEntrySourceRow>(
    sqlite,
    `${ledgerCtes}${duplicateJournalEntryRowsSql}`,
    scope,
  );
  return findDuplicateDiagnostics(drafts, journalEntries);
}

function accountCondition(
  filter: DraftStatusFilter,
  column: string,
  keyword: "AND" | "WHERE" = "AND",
): string {
  return filter.accountId === undefined
    ? ""
    : ` ${keyword} ${column} = @accountId`;
}

function withAccount(
  scope: ScopeParams,
  filter: DraftStatusFilter,
): Record<string, unknown> {
  return filter.accountId === undefined
    ? scope
    : { ...scope, accountId: filter.accountId };
}

function groupBy<T>(rows: readonly T[], key: (row: T) => number) {
  const groups = new Map<number, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

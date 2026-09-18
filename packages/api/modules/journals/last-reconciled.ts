import { allRows, type LedgerAuth } from "../ledger-sql/index.js";

/*
 * The last reconciled checkpoint: an account's latest posted balance
 * assertion, in the journal with the latest date and, on a tie, the highest
 * id. One query finds it. Home, Review and the last-reconciled report read it
 * for every account, and the statement import for the account it imports
 * into.
 */

export interface ReconciledCheckpoint {
  date: string;
  balance: number;
}

/** A balance assertion in an account's last reconciled journal. */
export type LastReconciledRow = {
  account_id: number;
  journal_id: number;
  account_name: string;
  last_reconciled_date: string;
  last_balance: number;
};

/**
 * The last reconciled checkpoint of every account, or of the account named
 * `accountName`. An account whose last reconciled journal asserts its balance
 * more than once has a row for each assertion, and the last is its
 * checkpoint. Rows are ordered by account name, account id and entry id.
 */
export function loadLastReconciled(
  sqlite: Parameters<typeof allRows>[0],
  auth: LedgerAuth,
  filter: { accountName?: string } = {},
): LastReconciledRow[] {
  return allRows<LastReconciledRow>(
    sqlite,
    auth,
    `
    SELECT
      a.id AS account_id,
      j.id AS journal_id,
      a.name AS account_name,
      j.date AS last_reconciled_date,
      je.account_balance_assertion AS last_balance
    FROM scoped_accounts a
    JOIN scoped_journal_entries je ON je.account_id = a.id
    JOIN scoped_journals j ON j.id = je.journal_id
    WHERE je.account_balance_assertion IS NOT NULL
      AND (@accountName IS NULL OR a.name = @accountName)
      AND j.id = (
        SELECT je2.journal_id
        FROM scoped_journal_entries je2
        JOIN scoped_journals j2 ON j2.id = je2.journal_id
        WHERE je2.account_id = a.id
          AND je2.account_balance_assertion IS NOT NULL
        ORDER BY j2.date DESC, j2.id DESC
        LIMIT 1
      )
    ORDER BY a.name, a.id, je.id`,
    { accountName: filter.accountName ?? null },
  );
}

/**
 * The checkpoint a statement import into `accountName` starts from: that
 * account's last reconciled checkpoint. A name is unique in a user's books,
 * so it is one account's.
 */
export function lookupLastReconciled(
  sqlite: Parameters<typeof allRows>[0],
  auth: LedgerAuth,
  accountName: string,
): ReconciledCheckpoint | null {
  const last = loadLastReconciled(sqlite, auth, { accountName }).at(-1);
  return last === undefined
    ? null
    : { date: last.last_reconciled_date, balance: last.last_balance };
}

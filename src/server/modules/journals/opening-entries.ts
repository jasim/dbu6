import { allRows, type LedgerAuth } from "../ledger-sql/index.js";

/*
 * Opening entries and where an account's posted history starts. An account's
 * opening entry is its line in the first journal, by date and then id, that
 * also has a line on an Equity account: the books' own record of what it held
 * or owed before its first transaction. Spending and transfers never touch
 * Equity, so only an opening entry does, whichever Equity account it names and
 * however many accounts it opens at once.
 */

/** An account's opening entry: debits positive, as a balance assertion is. */
export type OpeningEntry = {
  account_id: number;
  journal_id: number;
  date: string;
  amount: number;
  /** Its journal's description: what the user said it came from. */
  description: string;
};

/**
 * The opening entry of each asset and liability account that has one, or of
 * the one account with id `accountId`.
 */
export function loadOpeningEntries(
  sqlite: Parameters<typeof allRows>[0],
  auth: LedgerAuth,
  filter: { accountId?: number } = {},
): Map<number, OpeningEntry> {
  const rows = allRows<OpeningEntry>(
    sqlite,
    auth,
    `
    SELECT
      je.account_id,
      j.id AS journal_id,
      j.date,
      j.description,
      SUM(je.debit - je.credit) AS amount
    FROM scoped_journal_entries je
    JOIN scoped_journals j ON j.id = je.journal_id
    JOIN scoped_accounts a ON a.id = je.account_id
    WHERE a.account_type IN ('Asset', 'Liability')
      AND (@accountId IS NULL OR je.account_id = @accountId)
      AND EXISTS (
        SELECT 1
        FROM scoped_journal_entries equity_line
        JOIN scoped_accounts equity ON equity.id = equity_line.account_id
        WHERE equity_line.journal_id = j.id
          AND equity.account_type = 'Equity'
      )
    GROUP BY je.account_id, j.id, j.date, j.description
    ORDER BY j.date, j.id`,
    { accountId: filter.accountId ?? null },
  );
  const openings = new Map<number, OpeningEntry>();
  for (const row of rows) {
    if (!openings.has(row.account_id)) openings.set(row.account_id, row);
  }
  return openings;
}

/** The date of each account's first posted entry. */
export function loadFirstEntryDates(
  sqlite: Parameters<typeof allRows>[0],
  auth: LedgerAuth,
): Map<number, string> {
  const rows = allRows<{ account_id: number; first_date: string }>(
    sqlite,
    auth,
    `
    SELECT je.account_id, MIN(j.date) AS first_date
    FROM scoped_journal_entries je
    JOIN scoped_journals j ON j.id = je.journal_id
    GROUP BY je.account_id`,
  );
  return new Map(rows.map((row) => [row.account_id, row.first_date]));
}

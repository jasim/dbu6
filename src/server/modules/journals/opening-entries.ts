import type Database from "better-sqlite3";
import { and, eq, ne } from "drizzle-orm";
import { parsePlainDate, Temporal } from "@sapporta/shared/temporal";
import { OPENING_BALANCES_ACCOUNT } from "../accounts/index.js";
import { allRows, type LedgerAuth } from "../ledger-sql/index.js";
import {
  journalEntries,
  journalEntriesTable,
  journals,
  journalsTable,
} from "../../schema/journals.js";
import { cents } from "./insert-plan.js";

/*
 * Opening entries and the posted history beside them. An account's opening
 * entry is its line in the first journal, by date and then id, that also has
 * a line on an Equity account: the books' own record of what it held or owed
 * before its first transaction. Spending and transfers never touch Equity, so
 * only an opening entry does, whichever Equity account it names and however
 * many accounts it opens at once.
 *
 * A standalone one, a journal of the account's line and one Equity line and
 * nothing else, can be rewritten or deleted in place (Settings › Opening
 * balances). One that opens other accounts too, as the seeded books' and an
 * hledger import's do, is the user's to change in the journal itself.
 */

/** An account's opening entry: debits positive, as a balance assertion is. */
export type OpeningEntry = {
  account_id: number;
  journal_id: number;
  date: string;
  amount: number;
  /** Its journal's description: what the user said it came from. */
  description: string;
  /** Its journal holds the account's line and one Equity line, no more. */
  standalone: boolean;
  /**
   * Its Equity line is on Opening Balances, as every opening dbu6 records
   * is. One on another Equity account may be a statement row categorized
   * there, so what counts a bank or card's own transactions, or deletes an
   * opening with it, takes only these.
   */
  onOpeningBalances: boolean;
};

/*
 * `opening_journals (account_id, journal_id)`: each asset and liability
 * account's opening journal, continuing `allRows`' scoped relations. The one
 * definition of an opening entry, which both queries below read.
 */
const OPENING_JOURNALS = `
  , opening_journals AS (
    SELECT account_id, journal_id
    FROM (
      SELECT
        je.account_id,
        j.id AS journal_id,
        ROW_NUMBER() OVER (
          PARTITION BY je.account_id ORDER BY j.date, j.id
        ) AS position
      FROM scoped_journal_entries je
      JOIN scoped_journals j ON j.id = je.journal_id
      JOIN scoped_accounts a ON a.id = je.account_id
      WHERE a.account_type IN ('Asset', 'Liability')
        AND EXISTS (
          SELECT 1
          FROM scoped_journal_entries equity_line
          JOIN scoped_accounts equity ON equity.id = equity_line.account_id
          WHERE equity_line.journal_id = j.id
            AND equity.account_type = 'Equity'
        )
    )
    WHERE position = 1
  )`;

/**
 * The opening entry of each asset and liability account that has one, or of
 * the one account with id `accountId`.
 */
export function loadOpeningEntries(
  sqlite: Database.Database,
  auth: LedgerAuth,
  filter: { accountId?: number } = {},
): Map<number, OpeningEntry> {
  // An opening journal has the account's line and at least one Equity line,
  // so two lines are exactly those two.
  const rows = allRows<
    Omit<OpeningEntry, "standalone" | "onOpeningBalances"> & {
      lines: number;
      on_opening_balances: number;
    }
  >(
    sqlite,
    auth,
    `${OPENING_JOURNALS}
    SELECT
      o.account_id,
      j.id AS journal_id,
      j.date,
      j.description,
      (
        SELECT SUM(je.debit - je.credit)
        FROM scoped_journal_entries je
        WHERE je.journal_id = o.journal_id AND je.account_id = o.account_id
      ) AS amount,
      (
        SELECT COUNT(*)
        FROM scoped_journal_entries je
        WHERE je.journal_id = o.journal_id
      ) AS lines,
      EXISTS (
        SELECT 1
        FROM scoped_journal_entries je
        JOIN scoped_accounts equity ON equity.id = je.account_id
        WHERE je.journal_id = o.journal_id
          AND equity.account_type = 'Equity'
          AND equity.name = @openingBalances
      ) AS on_opening_balances
    FROM opening_journals o
    JOIN scoped_journals j ON j.id = o.journal_id
    WHERE @accountId IS NULL OR o.account_id = @accountId
    ORDER BY j.date, j.id`,
    {
      accountId: filter.accountId ?? null,
      openingBalances: OPENING_BALANCES_ACCOUNT,
    },
  );
  return new Map(
    rows.map(({ lines, on_opening_balances, ...row }) => [
      row.account_id,
      {
        ...row,
        standalone: lines === 2,
        onOpeningBalances: on_opening_balances === 1,
      },
    ]),
  );
}

/** An account's posted entries outside its opening journal. */
export type EntriesBesideOpening = {
  entries: number;
  first_date: string;
};

/**
 * For each account with a posted entry outside its opening journal, how many
 * there are and the first one's date. An account with no opening entry counts
 * all of its entries. Drafts are not posted, so they never count.
 */
export function loadEntriesBesideOpening(
  sqlite: Database.Database,
  auth: LedgerAuth,
): Map<number, EntriesBesideOpening> {
  const rows = allRows<EntriesBesideOpening & { account_id: number }>(
    sqlite,
    auth,
    `${OPENING_JOURNALS}
    SELECT je.account_id, COUNT(*) AS entries, MIN(j.date) AS first_date
    FROM scoped_journal_entries je
    JOIN scoped_journals j ON j.id = je.journal_id
    LEFT JOIN opening_journals o ON o.account_id = je.account_id
    WHERE o.journal_id IS NULL OR je.journal_id <> o.journal_id
    GROUP BY je.account_id`,
  );
  return new Map(rows.map(({ account_id, ...beside }) => [account_id, beside]));
}

/**
 * Rewrites a standalone opening entry in place: its journal's date and
 * description, the account's line with `amount` as its balance assertion,
 * and the Equity line opposite it. The ids stay, so a link to the journal
 * still finds it. In the caller's transaction.
 */
export function rewriteOpeningEntry(
  tx: any,
  auth: LedgerAuth,
  opening: OpeningEntry,
  change: { date: string; amount: number; description: string },
): void {
  requireStandalone(opening);
  const journalAccess = auth.rowSecurity.forTable(journals);
  const entryAccess = auth.rowSecurity.forTable(journalEntries);
  const now = Temporal.Now.instant();
  const { amount } = change;

  tx.update(journalsTable)
    .set({
      date: parsePlainDate(change.date),
      description: change.description,
      updated_at: now,
    })
    .where(journalAccess.ownedRows(eq(journalsTable.id, opening.journal_id)))
    .run();
  const inJournal = eq(journalEntriesTable.journal_id, opening.journal_id);
  const onAccount = eq(journalEntriesTable.account_id, opening.account_id);
  tx.update(journalEntriesTable)
    .set({
      debit: amount > 0 ? cents(amount) : 0,
      credit: amount < 0 ? cents(-amount) : 0,
      account_balance_assertion: cents(amount),
      updated_at: now,
    })
    .where(entryAccess.ownedRows(and(inJournal, onAccount)))
    .run();
  tx.update(journalEntriesTable)
    .set({
      debit: amount < 0 ? cents(-amount) : 0,
      credit: amount > 0 ? cents(amount) : 0,
      account_balance_assertion: null,
      updated_at: now,
    })
    .where(
      entryAccess.ownedRows(
        and(inJournal, ne(journalEntriesTable.account_id, opening.account_id)),
      ),
    )
    .run();
}

/**
 * Deletes a standalone opening entry: its lines, then its journal, which no
 * cascade removes. The Equity account stays. In the caller's transaction.
 */
export function deleteOpeningEntry(
  tx: any,
  auth: LedgerAuth,
  opening: OpeningEntry,
): void {
  requireStandalone(opening);
  const journalAccess = auth.rowSecurity.forTable(journals);
  const entryAccess = auth.rowSecurity.forTable(journalEntries);
  tx.delete(journalEntriesTable)
    .where(
      entryAccess.ownedRows(
        eq(journalEntriesTable.journal_id, opening.journal_id),
      ),
    )
    .run();
  tx.delete(journalsTable)
    .where(journalAccess.ownedRows(eq(journalsTable.id, opening.journal_id)))
    .run();
}

// A shared journal's other lines are other accounts' openings; rewriting or
// deleting it would change them too.
function requireStandalone(opening: OpeningEntry): void {
  if (!opening.standalone) {
    throw new Error(
      `Journal ${opening.journal_id} opens more than account ${opening.account_id}; change it by hand.`,
    );
  }
}

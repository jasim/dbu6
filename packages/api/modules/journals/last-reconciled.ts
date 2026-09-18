import { and, desc, eq, isNotNull } from "drizzle-orm";
import { formatPlainDate } from "@sapporta/shared/temporal";
import { accounts, accountsTable } from "../../schema/accounts.js";
import {
  journalEntries,
  journalEntriesTable,
  journals,
  journalsTable,
} from "../../schema/journals.js";
import {
  allRows,
  ledgerCtes,
  type LedgerAuth,
  type ScopeParams,
} from "../ledger-sql/index.js";

/*
 * The last reconciled checkpoint: an account's latest posted balance
 * assertion. The statement import looks it up for one account by name, and
 * Home, Review and the last-reconciled report load it for every account.
 * PLAN.md B2 makes these one query.
 */

export interface ReconciledCheckpoint {
  date: string;
  balance: number;
}

export function lookupLastReconciled(
  db: any,
  accountName: string,
  auth?: LedgerAuth,
): ReconciledCheckpoint | null {
  const accountAccess = auth?.rowSecurity.forTable(accounts);
  const journalAccess = auth?.rowSecurity.forTable(journals);
  const entryAccess = auth?.rowSecurity.forTable(journalEntries);
  const where = and(
    accountAccess
      ? accountAccess.ownedRows(eq(accountsTable.name, accountName))
      : eq(accountsTable.name, accountName),
    entryAccess
      ? entryAccess.ownedRows(
          isNotNull(journalEntriesTable.account_balance_assertion),
        )
      : isNotNull(journalEntriesTable.account_balance_assertion),
    journalAccess ? journalAccess.ownedRows() : undefined,
  );
  const assertion = db
    .select({
      date: journalsTable.date,
      assertion: journalEntriesTable.account_balance_assertion,
    })
    .from(journalEntriesTable)
    .innerJoin(
      journalsTable,
      eq(journalsTable.id, journalEntriesTable.journal_id),
    )
    .innerJoin(
      accountsTable,
      eq(accountsTable.id, journalEntriesTable.account_id),
    )
    .where(where)
    .orderBy(desc(journalsTable.date), desc(journalsTable.id))
    .limit(1)
    .get();
  if (assertion?.assertion == null) return null;
  return {
    date: formatPlainDate(assertion.date),
    balance: assertion.assertion,
  };
}

export type LastReconciledRow = {
  account_id: number;
  journal_id: number;
  account_name: string;
  last_reconciled_date: string;
  last_balance: number;
};

export function loadLastReconciled(
  sqlite: Parameters<typeof allRows>[0],
  scope: ScopeParams,
): LastReconciledRow[] {
  return allRows<LastReconciledRow>(
    sqlite,
    `${ledgerCtes}
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
      AND j.id = (
        SELECT je2.journal_id
        FROM scoped_journal_entries je2
        JOIN scoped_journals j2 ON j2.id = je2.journal_id
        WHERE je2.account_id = a.id
          AND je2.account_balance_assertion IS NOT NULL
        ORDER BY j2.date DESC, j2.id DESC
        LIMIT 1
      )
    ORDER BY a.name`,
    scope,
  );
}

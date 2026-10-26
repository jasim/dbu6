import { asc, eq } from "drizzle-orm";
import { formatPlainDate } from "@sapporta/shared/temporal";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { ExportAccount, ExportJournal } from "../hledger-export/index.js";
import type { LedgerAuth } from "../ledger-sql/index.js";
import { accounts, accountsTable } from "../../schema/accounts.js";
import {
  journalEntries,
  journalEntriesTable,
  journals,
  journalsTable,
} from "../../schema/journals.js";

export interface HledgerExportRows {
  accounts: ExportAccount[];
  journals: ExportJournal[];
}

// Every account in scope and every posted journal with its lines, as the
// hledger export reads them: journals by date then id, lines by id, the
// order the ledger's running balances and its assertions follow.
export function loadHledgerExportRows(
  db: BetterSQLite3Database,
  auth: LedgerAuth,
): HledgerExportRows {
  const accountAccess = auth.rowSecurity.forTable(accounts);
  const journalAccess = auth.rowSecurity.forTable(journals);
  const entryAccess = auth.rowSecurity.forTable(journalEntries);

  const accountRows = db
    .select({
      id: accountsTable.id,
      name: accountsTable.name,
      parent_id: accountsTable.parent_id,
      account_type: accountsTable.account_type,
    })
    .from(accountsTable)
    .where(accountAccess.ownedRows())
    .orderBy(asc(accountsTable.id))
    .all();

  const entryRows = db
    .select({
      journalId: journalsTable.id,
      date: journalsTable.date,
      description: journalsTable.description,
      entryId: journalEntriesTable.id,
      accountId: journalEntriesTable.account_id,
      debit: journalEntriesTable.debit,
      credit: journalEntriesTable.credit,
      assertion: journalEntriesTable.account_balance_assertion,
      comment: journalEntriesTable.comment,
      sourceNarration: journalEntriesTable.source_narration,
    })
    .from(journalEntriesTable)
    .innerJoin(
      journalsTable,
      eq(journalsTable.id, journalEntriesTable.journal_id),
    )
    .where(entryAccess.ownedRows(journalAccess.ownedRows()))
    .orderBy(
      asc(journalsTable.date),
      asc(journalsTable.id),
      asc(journalEntriesTable.id),
    )
    .all();

  const byId = new Map<number, ExportJournal>();
  for (const row of entryRows) {
    let journal = byId.get(row.journalId);
    if (journal === undefined) {
      journal = {
        id: row.journalId,
        date: formatPlainDate(row.date),
        description: row.description,
        entries: [],
      };
      byId.set(row.journalId, journal);
    }
    journal.entries.push({
      id: row.entryId,
      account_id: row.accountId,
      debit: row.debit,
      credit: row.credit,
      assertion: row.assertion,
      comment: row.comment,
      source_narration: row.sourceNarration,
    });
  }

  return { accounts: accountRows, journals: [...byId.values()] };
}

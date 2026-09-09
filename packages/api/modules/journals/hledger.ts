import { asc, eq, inArray } from "drizzle-orm";
import { formatPlainDate } from "@sapporta/shared/temporal";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { RowScopeAuth } from "../../bank-importer/draft-persistence.js";
import { accountsTable } from "../../schema/accounts.js";
import {
  journalEntries,
  journalEntriesTable,
  journals,
  journalsTable,
} from "../../schema/journals.js";

export interface RenderedJournalsHledger {
  hledger_journal: string;
  journal_count: number;
}

type JournalHledgerRow = {
  journalId: number;
  date: typeof journalsTable.$inferSelect.date;
  description: string;
  entryId: number;
  account: string;
  debit: number;
  credit: number;
  assertion: number | null;
  comment: string | null;
};

type JournalForHledger = {
  id: number;
  date: string;
  description: string;
  entries: JournalEntryForHledger[];
};

type JournalEntryForHledger = {
  account: string;
  amount: number;
  assertion: number | null;
  comment: string | null;
};

export function renderVisibleJournalsAsHledger({
  db,
  auth,
  journalIds,
}: {
  db: BetterSQLite3Database;
  auth: RowScopeAuth;
  journalIds: readonly number[];
}): RenderedJournalsHledger {
  const ids = uniqueIds(journalIds);
  if (ids.length === 0) {
    return { hledger_journal: "", journal_count: 0 };
  }

  const rows = loadJournalHledgerRows({ db, auth, journalIds: ids });
  const order = new Map(ids.map((id, index) => [id, index]));
  const journalsForHledger = groupRowsIntoJournals(rows, order);

  return {
    hledger_journal: formatJournalsAsHledger(journalsForHledger),
    journal_count: journalsForHledger.length,
  };
}

function loadJournalHledgerRows({
  db,
  auth,
  journalIds,
}: {
  db: BetterSQLite3Database;
  auth: RowScopeAuth;
  journalIds: readonly number[];
}): JournalHledgerRow[] {
  const journalAccess = auth.rowSecurity.forTable(journals);
  const entryAccess = auth.rowSecurity.forTable(journalEntries);

  return db
    .select({
      journalId: journalsTable.id,
      date: journalsTable.date,
      description: journalsTable.description,
      entryId: journalEntriesTable.id,
      account: accountsTable.name,
      debit: journalEntriesTable.debit,
      credit: journalEntriesTable.credit,
      assertion: journalEntriesTable.account_balance_assertion,
      comment: journalEntriesTable.comment,
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
    .where(
      entryAccess.ownedRows(
        journalAccess.ownedRows(inArray(journalsTable.id, [...journalIds])),
      ),
    )
    .orderBy(asc(journalsTable.id), asc(journalEntriesTable.id))
    .all();
}

function groupRowsIntoJournals(
  rows: readonly JournalHledgerRow[],
  order: ReadonlyMap<number, number>,
): JournalForHledger[] {
  const journalsById = new Map<number, JournalForHledger>();

  for (const row of rows) {
    let journal = journalsById.get(row.journalId);
    if (!journal) {
      journal = {
        id: row.journalId,
        date: formatPlainDate(row.date),
        description: row.description,
        entries: [],
      };
      journalsById.set(row.journalId, journal);
    }

    journal.entries.push({
      account: row.account,
      amount: row.debit - row.credit,
      assertion: row.assertion,
      comment: row.comment,
    });
  }

  return [...journalsById.values()].sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function formatJournalsAsHledger(
  journalsForHledger: readonly JournalForHledger[],
): string {
  return journalsForHledger.map(formatJournalAsHledger).join("\n\n");
}

function formatJournalAsHledger(journal: JournalForHledger): string {
  return [
    `${journal.date} ${journal.description}`,
    ...journal.entries.map(formatEntryAsHledger),
  ].join("\n");
}

function formatEntryAsHledger(entry: JournalEntryForHledger): string {
  const assertion =
    entry.assertion === null ? "" : ` = ${entry.assertion.toFixed(2)}`;
  const comment = entry.comment ? ` ; ${entry.comment}` : "";
  return `    ${entry.account.padEnd(35)} ${entry.amount.toFixed(2).padStart(10)}${assertion}${comment}`;
}

function uniqueIds(ids: readonly number[]): number[] {
  return [...new Set(ids.filter(Number.isFinite))];
}

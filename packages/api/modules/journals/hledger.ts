import { asc, eq, inArray } from "drizzle-orm";
import { formatPlainDate } from "@sapporta/shared/temporal";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  formatHledger,
  type JournalPlan,
  type PlannedJournal,
} from "../journal-plan/index.js";
import type { LedgerAuth } from "../ledger-sql/index.js";
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
  sourceReference: string | null;
  sourceTransactionKey: string | null;
};

// Posted journals as hledger text, in the order asked for: read back as the
// plan they were written from and rendered like any other plan.
export function renderVisibleJournalsAsHledger({
  db,
  auth,
  journalIds,
}: {
  db: BetterSQLite3Database;
  auth: LedgerAuth;
  journalIds: readonly number[];
}): RenderedJournalsHledger {
  const ids = uniqueIds(journalIds);
  if (ids.length === 0) {
    return { hledger_journal: "", journal_count: 0 };
  }

  const rows = loadJournalHledgerRows({ db, auth, journalIds: ids });
  const order = new Map(ids.map((id, index) => [id, index]));
  const plan = groupRowsIntoPlan(rows, order);

  return {
    hledger_journal: formatHledger(plan),
    journal_count: plan.length,
  };
}

function loadJournalHledgerRows({
  db,
  auth,
  journalIds,
}: {
  db: BetterSQLite3Database;
  auth: LedgerAuth;
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
      sourceReference: journalEntriesTable.source_reference,
      sourceTransactionKey: journalEntriesTable.source_transaction_key,
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

function groupRowsIntoPlan(
  rows: readonly JournalHledgerRow[],
  order: ReadonlyMap<number, number>,
): JournalPlan<string> {
  const journalsById = new Map<number, PlannedJournal<string>>();

  for (const row of rows) {
    let journal = journalsById.get(row.journalId);
    if (!journal) {
      journal = {
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
      sourceReference: row.sourceReference,
      sourceTransactionKey: row.sourceTransactionKey,
    });
  }

  const position = (id: number) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...journalsById.entries()]
    .sort(([a], [b]) => position(a) - position(b))
    .map(([, journal]) => journal);
}

function uniqueIds(ids: readonly number[]): number[] {
  return [...new Set(ids.filter(Number.isFinite))];
}

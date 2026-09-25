import { parsePlainDate } from "@sapporta/shared/temporal";
import type { JournalPlan } from "../journal-plan/index.js";
import type { LedgerAuth } from "../ledger-sql/index.js";
import {
  journalEntries,
  journalEntriesTable,
  journals,
  journalsTable,
} from "../../schema/journals.js";

export interface InsertedJournals {
  journals: number;
  entries: number;
  /** The new journals' ids, in the plan's order. */
  journalIds: number[];
}

/**
 * Writes a journal plan to the books: each planned journal and its entries,
 * by account id, a signed amount as a debit or a credit, in cents. Runs inside
 * the caller's transaction, so the caller decides what else commits with it.
 */
export function insertJournalPlan(
  tx: any,
  plan: JournalPlan<number>,
  auth: LedgerAuth,
): InsertedJournals {
  const journalAccess = auth.rowSecurity.forTable(journals);
  const entryAccess = auth.rowSecurity.forTable(journalEntries);
  const journalIds: number[] = [];
  let entryCount = 0;

  for (const insert of plan) {
    const journalValues = journalAccess.insertValuesSync(tx, {
      date: parsePlainDate(insert.date),
      description: insert.description,
    });
    const journal = tx
      .insert(journalsTable)
      .values(journalValues)
      .returning({ id: journalsTable.id })
      .get();

    const entryValues = insert.entries.map((entry) =>
      entryAccess.insertValuesSync(tx, {
        journal_id: journal.id,
        account_id: entry.account,
        debit: entry.amount > 0 ? cents(entry.amount) : 0,
        credit: entry.amount < 0 ? cents(-entry.amount) : 0,
        account_balance_assertion:
          entry.assertion === null ? null : cents(entry.assertion),
        comment: entry.comment,
        source_reference: entry.sourceReference,
        source_transaction_key: entry.sourceTransactionKey,
      }),
    );
    tx.insert(journalEntriesTable).values(entryValues).run();

    journalIds.push(journal.id);
    entryCount += insert.entries.length;
  }

  return { journals: journalIds.length, entries: entryCount, journalIds };
}

// Rounded as hledger prints it, so the books hold what the plan renders.
export function cents(value: number): number {
  return Number(value.toFixed(2));
}

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
}

/**
 * Writes a journal plan to the books: each planned journal and its entries.
 * Runs inside the caller's transaction, so the caller decides what else
 * commits with it.
 */
export function insertJournalPlan(
  tx: any,
  plan: JournalPlan,
  auth: LedgerAuth,
): InsertedJournals {
  const journalAccess = auth.rowSecurity.forTable(journals);
  const entryAccess = auth.rowSecurity.forTable(journalEntries);
  let journalCount = 0;
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
        account_id: entry.account_id,
        debit: Number(entry.debit),
        credit: Number(entry.credit),
        account_balance_assertion:
          entry.account_balance_assertion === null
            ? null
            : Number(entry.account_balance_assertion),
        comment: entry.comment,
        source_reference: entry.source_reference,
        source_transaction_key: entry.source_transaction_key,
      }),
    );
    tx.insert(journalEntriesTable).values(entryValues).run();

    journalCount++;
    entryCount += insert.entries.length;
  }

  return { journals: journalCount, entries: entryCount };
}

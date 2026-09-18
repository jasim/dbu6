import { and, eq } from "drizzle-orm";
import { formatPlainDate, type Temporal } from "@sapporta/shared/temporal";
import type { LedgerAuth } from "../ledger-sql/index.js";
import {
  draftTransactions,
  draftTransactionsTable,
} from "../../schema/draft-journals.js";
import {
  journalEntries,
  journalEntriesTable,
  journals,
  journalsTable,
} from "../../schema/journals.js";
import {
  matchDraftTransactions,
  matchTransactionToJournal,
  type JournalCandidate,
  type TransactionMatchType,
} from "./journal-transaction-matcher.js";
import type { TransactionIdentityInput } from "./transaction-identity.js";

export interface DuplicateLookupInput extends TransactionIdentityInput {
  databaseDate: Temporal.PlainDate;
}

export type DuplicateCandidate =
  | {
      target: "draft";
      id: number;
      matchType: TransactionMatchType;
      confidence: number;
    }
  | {
      target: "journal";
      id: number;
      journalEntryId: number;
      matchType: TransactionMatchType;
      confidence: number;
    };

function nullable(value: string | null | undefined): string | null {
  return value ?? null;
}

export function findDuplicateCandidates(
  db: any,
  input: DuplicateLookupInput,
  auth?: LedgerAuth,
): DuplicateCandidate[] {
  const draftAccess = auth?.rowSecurity.forTable(draftTransactions);
  const journalAccess = auth?.rowSecurity.forTable(journals);
  const entryAccess = auth?.rowSecurity.forTable(journalEntries);

  if (input.sourceTransactionKey !== null) {
    const exactDraftWhere = and(
      input.baseAccountId === null
        ? undefined
        : eq(draftTransactionsTable.base_account_id, input.baseAccountId),
      eq(
        draftTransactionsTable.source_transaction_key,
        input.sourceTransactionKey,
      ),
    );
    const exactDrafts = db
      .select({ id: draftTransactionsTable.id })
      .from(draftTransactionsTable)
      .where(
        draftAccess ? draftAccess.ownedRows(exactDraftWhere) : exactDraftWhere,
      )
      .all()
      .map((row: { id: number }) => ({
        target: "draft" as const,
        id: row.id,
        matchType: "source-key" as const,
        confidence: 1,
      }));

    const exactJournalWhere = and(
      eq(
        journalEntriesTable.source_transaction_key,
        input.sourceTransactionKey,
      ),
      journalAccess ? journalAccess.ownedRows() : undefined,
      entryAccess ? entryAccess.ownedRows() : undefined,
    );
    const exactJournals = db
      .select({
        journalId: journalsTable.id,
        entryId: journalEntriesTable.id,
      })
      .from(journalEntriesTable)
      .innerJoin(
        journalsTable,
        eq(journalsTable.id, journalEntriesTable.journal_id),
      )
      .where(exactJournalWhere)
      .all()
      .map((row: { journalId: number; entryId: number }) => ({
        target: "journal" as const,
        id: row.journalId,
        journalEntryId: row.entryId,
        matchType: "source-key" as const,
        confidence: 1,
      }));
    const exact = [...exactDrafts, ...exactJournals];
    if (exact.length > 0) return exact;
  }

  const draftWhere = and(
    input.baseAccountId === null
      ? undefined
      : eq(draftTransactionsTable.base_account_id, input.baseAccountId),
    eq(draftTransactionsTable.date, input.databaseDate),
  );
  const draftRows = db
    .select({
      id: draftTransactionsTable.id,
      date: draftTransactionsTable.date,
      narration: draftTransactionsTable.narration,
      withdrawal: draftTransactionsTable.withdrawal,
      deposit: draftTransactionsTable.deposit,
      accountId: draftTransactionsTable.account_id,
      baseAccountId: draftTransactionsTable.base_account_id,
      sourceReference: draftTransactionsTable.source_reference,
      sourceTransactionKey: draftTransactionsTable.source_transaction_key,
    })
    .from(draftTransactionsTable)
    .where(draftAccess ? draftAccess.ownedRows(draftWhere) : draftWhere)
    .all();

  const draftCandidates: DuplicateCandidate[] = draftRows.flatMap(
    (row: any) => {
      const match = matchDraftTransactions(input, {
        baseAccountId: row.baseAccountId,
        date: formatPlainDate(row.date),
        narration: row.narration,
        withdrawal: row.withdrawal,
        deposit: row.deposit,
        accountId: row.accountId,
        sourceReference: nullable(row.sourceReference),
        sourceTransactionKey: nullable(row.sourceTransactionKey),
      });
      return match ? [{ target: "draft" as const, id: row.id, ...match }] : [];
    },
  );

  const journalWhere = and(
    eq(journalsTable.date, input.databaseDate),
    journalAccess ? journalAccess.ownedRows() : undefined,
    entryAccess ? entryAccess.ownedRows() : undefined,
  );
  const entryRows = db
    .select({
      journalId: journalsTable.id,
      journalDate: journalsTable.date,
      journalDescription: journalsTable.description,
      entryId: journalEntriesTable.id,
      accountId: journalEntriesTable.account_id,
      debit: journalEntriesTable.debit,
      credit: journalEntriesTable.credit,
      comment: journalEntriesTable.comment,
      sourceReference: journalEntriesTable.source_reference,
      sourceTransactionKey: journalEntriesTable.source_transaction_key,
    })
    .from(journalEntriesTable)
    .innerJoin(
      journalsTable,
      eq(journalsTable.id, journalEntriesTable.journal_id),
    )
    .where(journalWhere)
    .all();

  const journalsById = new Map<number, JournalCandidate>();
  for (const row of entryRows as any[]) {
    let journal = journalsById.get(row.journalId);
    if (!journal) {
      journal = {
        id: row.journalId,
        date: formatPlainDate(row.journalDate),
        description: row.journalDescription,
        entries: [],
      };
      journalsById.set(row.journalId, journal);
    }
    journal.entries.push({
      id: row.entryId,
      accountId: row.accountId,
      debit: row.debit,
      credit: row.credit,
      comment: nullable(row.comment),
      sourceReference: nullable(row.sourceReference),
      sourceTransactionKey: nullable(row.sourceTransactionKey),
    });
  }

  const journalCandidates: DuplicateCandidate[] = [];
  for (const journal of journalsById.values()) {
    journalCandidates.push(
      ...matchTransactionToJournal(input, journal).map((match) => ({
        target: "journal" as const,
        id: match.journalId,
        journalEntryId: match.journalEntryId,
        matchType: match.matchType,
        confidence: match.confidence,
      })),
    );
  }

  return [...draftCandidates, ...journalCandidates];
}

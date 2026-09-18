import { and, eq, inArray } from "drizzle-orm";
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
  type TransactionIdentityInput,
} from "../transaction-identity/index.js";

export interface DuplicateLookupInput extends TransactionIdentityInput {
  baseAccountId: number;
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

// A statement row matches more than one stored draft or journal entry, so
// which one it duplicates can't be decided automatically.
export class AmbiguousDuplicateError extends Error {
  override readonly name = "AmbiguousDuplicateError";

  constructor(
    readonly sourceKey: string | null,
    readonly candidateIds: Array<number | string>,
  ) {
    super(
      `Transaction matches multiple existing candidates (${candidateIds.join(", ")}); refusing to choose one automatically.`,
    );
  }
}

// The stored rows a lookup reads: those carrying the row's key, or those on
// its date.
type Narrowing = { key: string } | { date: Temporal.PlainDate };

/**
 * The stored draft or posted journal entry a statement row duplicates, or
 * null when the row is new. The transaction-identity matchers decide what is
 * the same transaction; the queries only fetch what might be. A match on the
 * row's key wins over a looser one on its date, and more than one match
 * throws, since which of them the row duplicates can't be decided
 * automatically.
 */
export function findDuplicate(
  db: any,
  input: DuplicateLookupInput,
  auth: LedgerAuth,
): DuplicateCandidate | null {
  const keyed =
    input.sourceTransactionKey === null
      ? []
      : matchStored(db, input, auth, { key: input.sourceTransactionKey });
  const candidates =
    keyed.length > 0
      ? keyed
      : matchStored(db, input, auth, { date: input.databaseDate });
  if (candidates.length > 1) {
    throw new AmbiguousDuplicateError(
      input.sourceTransactionKey,
      candidates.map((candidate) =>
        candidate.target === "draft"
          ? `draft:${candidate.id}`
          : `journal:${candidate.id}:entry:${candidate.journalEntryId}`,
      ),
    );
  }
  return candidates[0] ?? null;
}

function matchStored(
  db: any,
  input: DuplicateLookupInput,
  auth: LedgerAuth,
  narrowing: Narrowing,
): DuplicateCandidate[] {
  const drafts = storedDrafts(db, input.baseAccountId, narrowing, auth).flatMap(
    (draft): DuplicateCandidate[] => {
      const match = matchDraftTransactions(input, draft);
      return match ? [{ target: "draft", id: draft.id, ...match }] : [];
    },
  );
  const entries = storedJournals(db, narrowing, auth).flatMap((journal) =>
    matchTransactionToJournal(input, journal).map(
      (match): DuplicateCandidate => ({
        target: "journal",
        id: match.journalId,
        journalEntryId: match.journalEntryId,
        matchType: match.matchType,
        confidence: match.confidence,
      }),
    ),
  );
  return [...drafts, ...entries];
}

// The base account's drafts the narrowing reads.
function storedDrafts(
  db: any,
  baseAccountId: number,
  narrowing: Narrowing,
  auth: LedgerAuth,
): Array<TransactionIdentityInput & { id: number }> {
  const draftAccess = auth.rowSecurity.forTable(draftTransactions);
  const rows = db
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
    .where(
      draftAccess.ownedRows(
        and(
          eq(draftTransactionsTable.base_account_id, baseAccountId),
          "key" in narrowing
            ? eq(draftTransactionsTable.source_transaction_key, narrowing.key)
            : eq(draftTransactionsTable.date, narrowing.date),
        ),
      ),
    )
    .all();
  return rows.map((row: any) => ({
    ...row,
    date: formatPlainDate(row.date),
    sourceReference: row.sourceReference ?? null,
    sourceTransactionKey: row.sourceTransactionKey ?? null,
  }));
}

// The posted journals the narrowing reads, each with all of its entries: a
// journal holding an entry with the key, or a journal on the date.
function storedJournals(
  db: any,
  narrowing: Narrowing,
  auth: LedgerAuth,
): JournalCandidate[] {
  const journalAccess = auth.rowSecurity.forTable(journals);
  const entryAccess = auth.rowSecurity.forTable(journalEntries);
  const journalWhere =
    "key" in narrowing
      ? inArray(
          journalsTable.id,
          db
            .select({ id: journalEntriesTable.journal_id })
            .from(journalEntriesTable)
            .where(
              entryAccess.ownedRows(
                eq(journalEntriesTable.source_transaction_key, narrowing.key),
              ),
            ),
        )
      : eq(journalsTable.date, narrowing.date);
  const rows = db
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
    .where(
      and(journalWhere, journalAccess.ownedRows(), entryAccess.ownedRows()),
    )
    .all();

  const journalsById = new Map<number, JournalCandidate>();
  for (const row of rows as any[]) {
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
      comment: row.comment ?? null,
      sourceReference: row.sourceReference ?? null,
      sourceTransactionKey: row.sourceTransactionKey ?? null,
    });
  }
  return [...journalsById.values()];
}

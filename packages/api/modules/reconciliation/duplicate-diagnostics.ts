import {
  matchDraftTransactions,
  matchTransactionToJournal,
  type JournalCandidate,
  type TransactionMatchType,
} from "./journal-transaction-matcher.js";
import {
  transactionDirection,
  type TransactionIdentityInput,
} from "./transaction-identity.js";

export const duplicateDraftRowsSql = `
SELECT
  dt.id AS draft_id,
  dt.date AS date,
  dt.narration AS narration,
  dt.withdrawal AS withdrawal,
  dt.deposit AS deposit,
  dt.account_id AS account_id,
  dt.base_account_id AS base_account_id,
  dt.source_reference AS source_reference,
  dt.source_transaction_key AS source_transaction_key,
  base.name AS base_account,
  cp.name AS draft_category
FROM scoped_draft_transactions dt
LEFT JOIN scoped_accounts base ON base.id = dt.base_account_id
LEFT JOIN scoped_accounts cp ON cp.id = dt.account_id
WHERE dt.base_account_id IS NOT NULL`;

export const duplicateJournalEntryRowsSql = `
SELECT
  j.id AS journal_id,
  j.date AS date,
  j.description AS journal_description,
  je.id AS entry_id,
  je.account_id AS account_id,
  je.debit AS debit,
  je.credit AS credit,
  je.comment AS comment,
  je.source_reference AS source_reference,
  je.source_transaction_key AS source_transaction_key,
  a.name AS account
FROM scoped_journal_entries je
JOIN scoped_journals j ON j.id = je.journal_id
JOIN scoped_accounts a ON a.id = je.account_id`;

export interface DuplicateDraftSourceRow {
  draft_id: number;
  date: string;
  narration: string;
  withdrawal: number;
  deposit: number;
  account_id: number | null;
  base_account_id: number;
  source_reference: string | null;
  source_transaction_key: string | null;
  base_account: string;
  draft_category: string | null;
}

export interface DuplicateJournalEntrySourceRow {
  journal_id: number;
  date: string;
  journal_description: string;
  entry_id: number;
  account_id: number;
  debit: number;
  credit: number;
  comment: string | null;
  source_reference: string | null;
  source_transaction_key: string | null;
  account: string;
}

export interface DuplicateDiagnostic extends Record<string, unknown> {
  match_kind: "draft-draft" | "draft-journal";
  match_type: TransactionMatchType;
  confidence: number;
  date: string;
  base_account_id: number;
  base_account: string;
  draft_id: number;
  other_draft_id: number | null;
  matched_journal_id: number | null;
  matched_journal_entry_id: number | null;
  direction: "deposit" | "withdrawal";
  amount: number;
  narration: string;
  other_narration: string | null;
  source_reference: string | null;
  source_transaction_key: string | null;
  other_source_reference: string | null;
  other_source_transaction_key: string | null;
  draft_category: string | null;
  matched_category: string | null;
}

function identity(row: DuplicateDraftSourceRow): TransactionIdentityInput {
  return {
    baseAccountId: row.base_account_id,
    date: row.date,
    narration: row.narration,
    withdrawal: row.withdrawal,
    deposit: row.deposit,
    accountId: row.account_id,
    sourceReference: row.source_reference,
    sourceTransactionKey: row.source_transaction_key,
  };
}

export function findDuplicateDiagnostics(
  drafts: DuplicateDraftSourceRow[],
  journalEntryRows: DuplicateJournalEntrySourceRow[],
): DuplicateDiagnostic[] {
  const journalsById = new Map<number, JournalCandidate>();
  const journalRowsByEntryId = new Map<
    number,
    DuplicateJournalEntrySourceRow
  >();
  for (const row of journalEntryRows) {
    journalRowsByEntryId.set(row.entry_id, row);
    let journal = journalsById.get(row.journal_id);
    if (!journal) {
      journal = {
        id: row.journal_id,
        date: row.date,
        description: row.journal_description,
        entries: [],
      };
      journalsById.set(row.journal_id, journal);
    }
    journal.entries.push({
      id: row.entry_id,
      accountId: row.account_id,
      debit: row.debit,
      credit: row.credit,
      comment: row.comment,
      sourceReference: row.source_reference,
      sourceTransactionKey: row.source_transaction_key,
    });
  }

  const diagnostics: DuplicateDiagnostic[] = [];
  for (let leftIndex = 0; leftIndex < drafts.length; leftIndex++) {
    const left = drafts[leftIndex];
    const leftIdentity = identity(left);
    const direction = transactionDirection(leftIdentity);
    const amount = direction === "deposit" ? left.deposit : left.withdrawal;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < drafts.length;
      rightIndex++
    ) {
      const right = drafts[rightIndex];
      const match = matchDraftTransactions(leftIdentity, identity(right));
      if (!match) continue;
      diagnostics.push({
        match_kind: "draft-draft",
        match_type: match.matchType,
        confidence: match.confidence,
        date: left.date,
        base_account_id: left.base_account_id,
        base_account: left.base_account,
        draft_id: left.draft_id,
        other_draft_id: right.draft_id,
        matched_journal_id: null,
        matched_journal_entry_id: null,
        direction,
        amount,
        narration: left.narration,
        other_narration: right.narration,
        source_reference: left.source_reference,
        source_transaction_key: left.source_transaction_key,
        other_source_reference: right.source_reference,
        other_source_transaction_key: right.source_transaction_key,
        draft_category: left.draft_category,
        matched_category: right.draft_category,
      });
    }

    for (const journal of journalsById.values()) {
      for (const match of matchTransactionToJournal(leftIdentity, journal)) {
        const entry = journalRowsByEntryId.get(match.journalEntryId)!;
        diagnostics.push({
          match_kind: "draft-journal",
          match_type: match.matchType,
          confidence: match.confidence,
          date: left.date,
          base_account_id: left.base_account_id,
          base_account: left.base_account,
          draft_id: left.draft_id,
          other_draft_id: null,
          matched_journal_id: match.journalId,
          matched_journal_entry_id: match.journalEntryId,
          direction,
          amount,
          narration: left.narration,
          other_narration: entry.comment,
          source_reference: left.source_reference,
          source_transaction_key: left.source_transaction_key,
          other_source_reference: entry.source_reference,
          other_source_transaction_key: entry.source_transaction_key,
          draft_category: left.draft_category,
          matched_category: entry.account,
        });
      }
    }
  }
  return diagnostics.sort(
    (left, right) =>
      right.date.localeCompare(left.date) || left.draft_id - right.draft_id,
  );
}

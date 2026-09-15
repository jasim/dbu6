import {
  direction as transactionDirection,
  type Direction,
} from "../../bank-importer/domain/Money.js";
import {
  normalizeIdentityText,
  sameLegacyTransaction,
  transactionAmountMinor,
  type TransactionIdentityInput,
} from "./transaction-identity.js";

export type TransactionMatchType =
  | "source-key"
  | "legacy-draft"
  | "itemized-journal-leg"
  | "base-account-payment";

export interface TransactionMatch {
  matchType: TransactionMatchType;
  confidence: number;
}

export interface JournalEntryCandidate {
  id: number;
  accountId: number;
  debit: number;
  credit: number;
  comment: string | null;
  sourceReference: string | null;
  sourceTransactionKey: string | null;
}

export interface JournalCandidate {
  id: number;
  date: string;
  description: string;
  entries: JournalEntryCandidate[];
}

export interface JournalTransactionMatch extends TransactionMatch {
  journalId: number;
  journalEntryId: number;
}

export function matchDraftTransactions(
  left: TransactionIdentityInput,
  right: TransactionIdentityInput,
): TransactionMatch | null {
  if (left.baseAccountId !== right.baseAccountId) return null;
  if (
    left.sourceTransactionKey !== null &&
    right.sourceTransactionKey !== null
  ) {
    return left.sourceTransactionKey === right.sourceTransactionKey
      ? { matchType: "source-key", confidence: 1 }
      : null;
  }
  return sameLegacyTransaction(left, right)
    ? { matchType: "legacy-draft", confidence: 0.8 }
    : null;
}

function entryAmountMinor(entry: JournalEntryCandidate, direction: Direction) {
  return Math.round(
    (direction === "deposit" ? entry.credit : entry.debit) * 100,
  );
}

function isPaymentNarration(narration: string): boolean {
  return /(?:payment|autopay|auto\s*debit|bill\s*pay|card\s*pay|imps|neft|upi)/i.test(
    narration,
  );
}

function narrationOrReferenceMatches(
  transaction: TransactionIdentityInput,
  entry: JournalEntryCandidate,
): boolean {
  if (transaction.sourceReference && entry.sourceReference) {
    return (
      normalizeIdentityText(transaction.sourceReference) ===
      normalizeIdentityText(entry.sourceReference)
    );
  }
  return (
    entry.comment !== null &&
    normalizeIdentityText(transaction.narration) ===
      normalizeIdentityText(entry.comment)
  );
}

export function matchTransactionToJournal(
  transaction: TransactionIdentityInput,
  journal: JournalCandidate,
): JournalTransactionMatch[] {
  const baseEntries = journal.entries.filter(
    (entry) => entry.accountId === transaction.baseAccountId,
  );
  if (baseEntries.length === 0) return [];

  if (transaction.sourceTransactionKey !== null) {
    const exact = journal.entries
      .filter(
        (entry) =>
          entry.sourceTransactionKey === transaction.sourceTransactionKey,
      )
      .map((entry) => ({
        matchType: "source-key" as const,
        confidence: 1,
        journalId: journal.id,
        journalEntryId: entry.id,
      }));
    if (exact.length > 0) return exact;

    // A keyed journal is authoritative. If none of its itemized legs has this
    // key, do not fall back to a looser semantic match against that journal.
    if (journal.entries.some((entry) => entry.sourceTransactionKey !== null)) {
      return [];
    }
  }

  if (transaction.date !== journal.date) return [];

  const direction = transactionDirection(transaction);
  const amountMinor = transactionAmountMinor(transaction);
  if (transaction.accountId !== null) {
    return journal.entries
      .filter((entry) => entry.accountId === transaction.accountId)
      .filter((entry) => entryAmountMinor(entry, direction) === amountMinor)
      .filter((entry) => narrationOrReferenceMatches(transaction, entry))
      .map((entry) => ({
        matchType: "itemized-journal-leg" as const,
        confidence: 0.95,
        journalId: journal.id,
        journalEntryId: entry.id,
      }));
  }

  if (direction !== "deposit" || !isPaymentNarration(transaction.narration)) {
    return [];
  }
  return baseEntries
    .filter((entry) => Math.round(entry.debit * 100) === amountMinor)
    .map((entry) => ({
      matchType: "base-account-payment" as const,
      confidence: 0.9,
      journalId: journal.id,
      journalEntryId: entry.id,
    }));
}

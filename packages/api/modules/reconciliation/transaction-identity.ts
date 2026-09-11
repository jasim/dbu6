import { createHash } from "node:crypto";
import type { Abacus } from "../../bank-importer/abacus/index.js";
import type { Account } from "../../bank-importer/domain/Account.js";
import {
  unsafeAsChrono,
  type Chrono,
} from "../../bank-importer/domain/Chrono.js";

export type TransactionDirection = "deposit" | "withdrawal";

export interface TransactionIdentityInput {
  baseAccountId: number | null;
  date: string;
  narration: string;
  withdrawal: number;
  deposit: number;
  accountId: number | null;
  sourceReference: string | null;
  sourceTransactionKey: string | null;
}

export function normalizeIdentityText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

export function transactionDirection(
  transaction: Pick<Abacus, "deposit" | "withdrawal">,
): TransactionDirection {
  return transaction.deposit > 0 ? "deposit" : "withdrawal";
}

export function transactionAmountMinor(
  transaction: Pick<Abacus, "deposit" | "withdrawal">,
): number {
  const amount =
    transaction.deposit > 0 ? transaction.deposit : transaction.withdrawal;
  return Math.round(amount * 100);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fallbackIdentityBase(
  baseAccount: Account,
  transaction: Abacus,
): string {
  return [
    normalizeIdentityText(baseAccount),
    transaction.date,
    transactionDirection(transaction),
    String(transactionAmountMinor(transaction)),
    normalizeIdentityText(transaction.narration),
  ].join("|");
}

function referencedIdentityBase(
  baseAccount: Account,
  transaction: Abacus,
  sourceReference: string,
): string {
  return [
    normalizeIdentityText(baseAccount),
    normalizeIdentityText(sourceReference),
    transaction.date,
    transactionDirection(transaction),
    String(transactionAmountMinor(transaction)),
  ].join("|");
}

export function assignSourceTransactionKeys(
  transactions: Chrono<Abacus>,
  baseAccount: Account,
): Chrono<Abacus> {
  const occurrences = new Map<string, number>();
  const referencedOccurrences = new Map<string, number>();
  return unsafeAsChrono(
    transactions.map((transaction) => {
      if (transaction.source_transaction_key) return transaction;
      const sourceReference = transaction.source_reference?.trim() || null;
      if (sourceReference !== null) {
        const identityBase = referencedIdentityBase(
          baseAccount,
          transaction,
          sourceReference,
        );
        const occurrence = (referencedOccurrences.get(identityBase) ?? 0) + 1;
        referencedOccurrences.set(identityBase, occurrence);
        return {
          ...transaction,
          source_reference: sourceReference,
          source_transaction_key: `ref:${digest(
            `${identityBase}|occurrence:${occurrence}`,
          )}`,
        };
      }

      const identityBase = fallbackIdentityBase(baseAccount, transaction);
      const occurrence = (occurrences.get(identityBase) ?? 0) + 1;
      occurrences.set(identityBase, occurrence);
      return {
        ...transaction,
        source_reference: null,
        source_transaction_key: `semantic:${digest(
          `${identityBase}|occurrence:${occurrence}`,
        )}`,
      };
    }),
  );
}

export function sameLegacyTransaction(
  left: TransactionIdentityInput,
  right: TransactionIdentityInput,
): boolean {
  if (left.baseAccountId !== right.baseAccountId) return false;
  if (left.date !== right.date) return false;
  if (transactionDirection(left) !== transactionDirection(right)) return false;
  if (transactionAmountMinor(left) !== transactionAmountMinor(right))
    return false;

  const leftReference = left.sourceReference
    ? normalizeIdentityText(left.sourceReference)
    : null;
  const rightReference = right.sourceReference
    ? normalizeIdentityText(right.sourceReference)
    : null;
  if (leftReference !== null && rightReference !== null) {
    return leftReference === rightReference;
  }
  return (
    normalizeIdentityText(left.narration) ===
    normalizeIdentityText(right.narration)
  );
}

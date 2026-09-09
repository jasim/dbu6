import type { CategorizedTransaction } from "./CategorizedTransaction.js";
import type { Chrono } from "./Chrono.js";
import { isWithdrawal } from "./Money.js";

export interface TransactionGroup<
  T extends CategorizedTransaction = CategorizedTransaction,
> {
  date: string;
  type: "deposit" | "withdrawal";
  transactions: T[];
  endOfGroupBalance: number | null;
}

/**
 * Group transactions by date, then split each date group by transaction type.
 *
 * Within each date, a new group starts whenever the type changes. A day with
 * [withdrawal, deposit, withdrawal] produces 3 groups.
 *
 * Input is chronological, so the last transaction in each group is the
 * group's end balance.
 */
export function groupByDateAndType<T extends CategorizedTransaction>(
  transactions: Chrono<T>,
): TransactionGroup<T>[] {
  const groups: TransactionGroup<T>[] = [];
  let currentGroup: TransactionGroup<T> | null = null;

  for (const ct of transactions) {
    const date = ct.transaction.date;
    const type: "withdrawal" | "deposit" = isWithdrawal(ct.transaction)
      ? "withdrawal"
      : "deposit";

    // Start a new group when date or type changes
    if (
      currentGroup === null ||
      currentGroup.date !== date ||
      currentGroup.type !== type
    ) {
      if (currentGroup !== null) {
        groups.push(currentGroup);
      }
      currentGroup = {
        date,
        type,
        transactions: [],
        endOfGroupBalance: null,
      };
    }

    currentGroup.transactions.push(ct);
  }

  if (currentGroup !== null) {
    groups.push(currentGroup);
  }

  for (const group of groups) {
    if (group.transactions.length === 0) continue;
    const lastTxn = group.transactions[group.transactions.length - 1];
    group.endOfGroupBalance = lastTxn.transaction.balance;
  }

  return groups;
}

import type { CategorizedTransaction } from "../categorization/index.js";

// A draft as categorization and the journal plan read it. A draft keeps no
// running balance, so `transaction.balance` is null; `assertion` is the base
// account's balance the draft asserts, which only a day's last draft holds.
export interface DraftCategorizedTransaction extends CategorizedTransaction {
  draftId: number;
  accountId: number | null;
  assertion: number | null;
}

export interface CategorizedDraft extends DraftCategorizedTransaction {
  accountId: number;
}

export function isCategorized(
  d: DraftCategorizedTransaction,
): d is CategorizedDraft {
  return d.accountId !== null;
}

export function partitionByCategorization(
  drafts: DraftCategorizedTransaction[],
): {
  categorized: CategorizedDraft[];
  uncategorized: DraftCategorizedTransaction[];
} {
  const categorized: CategorizedDraft[] = [];
  const uncategorized: DraftCategorizedTransaction[] = [];
  for (const d of drafts) {
    if (isCategorized(d)) categorized.push(d);
    else uncategorized.push(d);
  }
  return { categorized, uncategorized };
}

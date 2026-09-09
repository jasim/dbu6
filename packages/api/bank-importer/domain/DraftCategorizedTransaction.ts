import type { CategorizedTransaction } from "./CategorizedTransaction.js";

export interface DraftCategorizedTransaction extends CategorizedTransaction {
  draftId: number;
  accountId: number | null;
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

import { eq, inArray } from "drizzle-orm";
import { formatPlainDate } from "@sapporta/shared/temporal";
import type { Abacus } from "../../bank-importer/domain/Abacus.js";
import { enrichWithGPayHtml } from "../../bank-importer/domain/GPayIndex.js";
import {
  resolveCategories,
  type CategorizationConfig,
} from "../../bank-importer/categorization/resolve.js";
import {
  loadAccountsByName,
  resolveAccountIdForCategorized,
  type RowScopeAuth,
} from "../../bank-importer/draft-persistence.js";
import {
  draftTransactions,
  draftTransactionsTable,
} from "../../schema/draft-journals.js";

type DraftTransactionRow = typeof draftTransactionsTable.$inferSelect;

export interface ClassifiedDraftTransaction {
  id: number;
  narration: string;
  account_id: number | null;
  account_name: string | null;
}

export interface DraftClassificationResult {
  transactions: ClassifiedDraftTransaction[];
  gpayEnrichedCount: number;
}

export async function classifyDraftTransactions(input: {
  db: any;
  auth: RowScopeAuth;
  ids: number[];
  categorizationConfig: CategorizationConfig;
  gpayHtmlPath?: string;
}): Promise<DraftClassificationResult> {
  const { db, auth, ids, categorizationConfig, gpayHtmlPath } = input;
  const draftAccess = auth.rowSecurity.forTable(draftTransactions);
  const drafts: DraftTransactionRow[] = db
    .select()
    .from(draftTransactionsTable)
    .where(draftAccess.ownedRows(inArray(draftTransactionsTable.id, ids)))
    .all();

  if (drafts.length === 0) {
    return { transactions: [], gpayEnrichedCount: 0 };
  }

  const sourceTransactions: Abacus[] = drafts.map((draft) => ({
    date: formatPlainDate(draft.date),
    narration: draft.narration,
    withdrawal: draft.withdrawal,
    deposit: draft.deposit,
    balance: null,
  }));
  const enrichment = gpayHtmlPath
    ? enrichWithGPayHtml(sourceTransactions, gpayHtmlPath)
    : { enriched: sourceTransactions, matchCount: 0, indexSize: 0 };
  const categorized = await resolveCategories(
    enrichment.enriched,
    categorizationConfig,
  );

  const accountsByName = loadAccountsByName(db, auth);
  const accountNameById = new Map<number, string>();
  for (const [name, id] of accountsByName) accountNameById.set(id, name);

  const transactions: ClassifiedDraftTransaction[] = [];
  db.transaction((tx: any) => {
    drafts.forEach((draft, index) => {
      const narration = enrichment.enriched[index].narration;
      const { accountId } = resolveAccountIdForCategorized(
        categorized[index].account,
        accountsByName,
        draft.base_account_id,
      );
      tx.update(draftTransactionsTable)
        .set({ narration, account_id: accountId })
        .where(draftAccess.ownedRows(eq(draftTransactionsTable.id, draft.id)))
        .run();
      transactions.push({
        id: draft.id,
        narration,
        account_id: accountId,
        account_name:
          accountId === null ? null : (accountNameById.get(accountId) ?? null),
      });
    });
  });

  return {
    transactions,
    gpayEnrichedCount: enrichment.matchCount,
  };
}

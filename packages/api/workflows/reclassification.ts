import { formatPlainDate } from "@sapporta/shared/temporal";
import type { CategorizationReport } from "dbu6-shared";
import type { Abacus } from "../modules/statement/index.js";
import { enrichWithGPayHtml } from "../modules/gpay/index.js";
import { moneyFromColumns } from "../modules/values/index.js";
import {
  resolveCategories,
  type CategorizationConfig,
  resolveAccountIdForCategorized,
} from "../modules/categorization/index.js";
import { loadAccountsByName } from "../modules/accounts/index.js";
import {
  loadDraftsById,
  saveReclassifiedDrafts,
  type ReclassifiedDraft,
} from "../modules/drafts/index.js";
import type { LedgerAuth } from "../modules/ledger-sql/index.js";

export interface ClassifiedDraftTransaction {
  id: number;
  narration: string;
  account_id: number | null;
  account_name: string | null;
}

export interface DraftClassificationResult {
  transactions: ClassifiedDraftTransaction[];
  gpayEnrichedCount: number;
  categorization: CategorizationReport;
}

export async function classifyDraftTransactions(input: {
  db: any;
  auth: LedgerAuth;
  ids: number[];
  categorizationConfig: CategorizationConfig;
  gpayHtmlPath?: string;
}): Promise<DraftClassificationResult> {
  const { db, auth, ids, categorizationConfig, gpayHtmlPath } = input;
  const drafts = loadDraftsById(db, ids, auth);

  const sourceTransactions: Abacus[] = drafts.map((draft) => ({
    date: formatPlainDate(draft.date),
    narration: draft.narration,
    ...moneyFromColumns(draft),
    balance: null,
  }));
  const enrichment = gpayHtmlPath
    ? enrichWithGPayHtml(sourceTransactions, gpayHtmlPath)
    : { enriched: sourceTransactions, matchCount: 0, indexSize: 0 };
  const { categorized, report } = await resolveCategories(
    enrichment.enriched,
    categorizationConfig,
  );

  const accountsByName = loadAccountsByName(db, auth);
  const accountNameById = new Map<number, string>();
  for (const [name, id] of accountsByName) accountNameById.set(id, name);

  const reclassified: ReclassifiedDraft[] = drafts.map((draft, index) => ({
    id: draft.id,
    narration: enrichment.enriched[index].narration,
    accountId: resolveAccountIdForCategorized(
      categorized[index].account,
      accountsByName,
      draft.base_account_id,
    ).accountId,
  }));
  saveReclassifiedDrafts(db, reclassified, auth);

  const transactions: ClassifiedDraftTransaction[] = reclassified.map(
    ({ id, narration, accountId }) => ({
      id,
      narration,
      account_id: accountId,
      account_name:
        accountId === null ? null : (accountNameById.get(accountId) ?? null),
    }),
  );

  return {
    transactions,
    gpayEnrichedCount: enrichment.matchCount,
    categorization: report,
  };
}

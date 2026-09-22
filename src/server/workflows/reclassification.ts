import { formatPlainDate } from "@sapporta/shared/temporal";
import type { CategorizationReport, CategorizationTally } from "../../shared/index.js";
import type { Abacus } from "../modules/statement/index.js";
import { enrichWithGPay, parseGPayHtml } from "../modules/gpay/index.js";
import { moneyFromColumns } from "../modules/values/index.js";
import {
  categorize,
  tallyCategorization,
  type LoadCategorizer,
} from "../modules/categorization/index.js";
import { categorizationLlm } from "../modules/coding-agent/index.js";
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
  // Every draft classified, by who categorized it.
  categorizationTally: CategorizationTally;
}

// Categorize drafts again, as an import categorizes its rows, optionally
// after naming their Google Pay recipients from a staged Takeout.
export async function classifyDraftTransactions(input: {
  db: any;
  auth: LedgerAuth;
  ids: number[];
  customMappingsFilenames: readonly string[];
  gpayHtmlPath?: string;
  loadCategorizer: LoadCategorizer;
}): Promise<DraftClassificationResult> {
  const { db, auth, ids, customMappingsFilenames, gpayHtmlPath } = input;
  const categorizer = await input.loadCategorizer({
    customMappingsFilenames,
    llm: await categorizationLlm(),
  });
  const drafts = loadDraftsById(db, ids, auth);

  const sourceTransactions: Abacus[] = drafts.map((draft) => ({
    date: formatPlainDate(draft.date),
    narration: draft.narration,
    ...moneyFromColumns(draft),
    balance: null,
  }));
  const enrichment = gpayHtmlPath
    ? enrichWithGPay(sourceTransactions, parseGPayHtml(gpayHtmlPath))
    : { enriched: sourceTransactions, matchCount: 0 };

  const accountsByName = loadAccountsByName(db, auth);
  const { rows, report } = await categorize(
    categorizer,
    drafts.map((draft, index) => ({
      transaction: enrichment.enriched[index],
      baseAccountId: draft.base_account_id,
    })),
    accountsByName,
  );
  const accountNameById = new Map<number, string>();
  for (const [name, { id }] of accountsByName) accountNameById.set(id, name);

  const reclassified: ReclassifiedDraft[] = drafts.map((draft, index) => ({
    id: draft.id,
    narration: rows[index].transaction.narration,
    accountId: rows[index].accountId,
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
    categorizationTally: tallyCategorization(rows),
  };
}

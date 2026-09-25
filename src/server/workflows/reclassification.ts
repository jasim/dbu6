import { formatPlainDate } from "@sapporta/shared/temporal";
import type {
  CategorizationLesson,
  CategorizationReport,
  CategorizationTally,
} from "../../shared/index.js";
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
  clearCategorizationLessons,
  deleteCategorizationLesson,
  insertCategorizationLesson,
  loadCategorizationLesson,
  loadDraftsById,
  saveReclassifiedDrafts,
  type ReclassifiedDraft,
} from "../modules/drafts/index.js";
import type { Ledger, LedgerAuth } from "../modules/ledger-sql/index.js";

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

export type SetDraftsCategoryOutcome =
  | { kind: "set"; updated: number }
  | { kind: "account-not-found" }
  | { kind: "drafts-not-found"; ids: number[] }
  | { kind: "own-account" };

// Give every draft the one category the user chose, or none of them when the
// category isn't in the books, a draft isn't, or the category is a draft's
// own base account.
export function setDraftsCategory(
  ledger: Ledger,
  ids: readonly number[],
  accountId: number,
): SetDraftsCategoryOutcome {
  const checked = checkDraftsCategory(ledger, ids, accountId);
  if (checked.kind !== "valid") return checked;
  saveReclassifiedDrafts(
    ledger.db,
    checked.drafts.map((draft) => ({
      id: draft.id,
      narration: draft.narration,
      accountId,
    })),
    ledger.auth,
  );
  return { kind: "set", updated: checked.drafts.length };
}

// The drafts, when they may all go to the account: it is in the books, so is
// every draft, and it isn't a draft's own base account.
function checkDraftsCategory(
  ledger: Ledger,
  ids: readonly number[],
  accountId: number,
):
  | { kind: "valid"; drafts: ReturnType<typeof loadDraftsById> }
  | Exclude<SetDraftsCategoryOutcome, { kind: "set" }> {
  const { db, auth } = ledger;
  const accounts = [...loadAccountsByName(db, auth).values()];
  if (!accounts.some((account) => account.id === accountId)) {
    return { kind: "account-not-found" };
  }
  const wanted = [...new Set(ids)];
  const drafts = loadDraftsById(db, wanted, auth);
  if (drafts.length !== wanted.length) {
    const found = new Set(drafts.map((draft) => draft.id));
    return {
      kind: "drafts-not-found",
      ids: wanted.filter((id) => !found.has(id)),
    };
  }
  if (drafts.some((draft) => draft.base_account_id === accountId)) {
    return { kind: "own-account" };
  }
  return { kind: "valid", drafts };
}

export type TeachCategorizationOutcome =
  | { kind: "taught"; lesson: CategorizationLesson }
  | Exclude<SetDraftsCategoryOutcome, { kind: "set" }>
  | { kind: "not-one-account" };

/**
 * Records that drafts of one statement account go to the account the user
 * chose, as a lesson for the coding agent to turn into a rule. The drafts
 * keep no category: the categorizer gives them one once the rule is in.
 */
export function teachCategorization(
  ledger: Ledger,
  lesson: { draftIds: readonly number[]; accountId: number; note: string },
): TeachCategorizationOutcome {
  const { auth } = ledger;
  return ledger.db.transaction((tx: any): TeachCategorizationOutcome => {
    const checked = checkDraftsCategory(
      { ...ledger, db: tx },
      lesson.draftIds,
      lesson.accountId,
    );
    if (checked.kind !== "valid") return checked;
    const baseAccounts = new Set(
      checked.drafts.map((draft) => draft.base_account_id),
    );
    const [baseAccountId] = baseAccounts;
    if (baseAccounts.size > 1 || baseAccountId == null) {
      return { kind: "not-one-account" };
    }
    const id = insertCategorizationLesson(tx, auth, {
      baseAccountId,
      accountId: lesson.accountId,
      narrations: checked.drafts.map((draft) => draft.narration),
      note: lesson.note.trim(),
    });
    const taught = loadCategorizationLesson(tx, auth, id);
    if (!taught) throw new Error(`Lesson ${id} vanished as it was added`);
    return { kind: "taught", lesson: taught };
  });
}

/** Deletes a lesson, taught or not wanted. */
export function forgetCategorizationLesson(ledger: Ledger, id: number): number {
  return deleteCategorizationLesson(ledger.db, ledger.auth, id);
}

/** Deletes every lesson of a statement account. */
export function forgetCategorizationLessons(
  ledger: Ledger,
  baseAccountId: number,
): number {
  return clearCategorizationLessons(ledger.db, ledger.auth, baseAccountId);
}

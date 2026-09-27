import { formatPlainDate } from "@sapporta/shared/temporal";
import type {
  CategorizationLesson,
  CategorizationReport,
  CategorizationTally,
} from "../../shared/index.js";
import type { Abacus } from "../modules/statement/index.js";
import { enrichWithGPay, parseGPayHtml } from "../modules/gpay/index.js";
import {
  amount,
  direction,
  moneyFromColumns,
} from "../modules/values/index.js";
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
  source_narration: string;
  comment: string | null;
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
// after naming their Google Pay recipients from a staged Takeout: a draft's
// source narration gets its recipient in front, if it hasn't one, and the
// recipient becomes its comment if it has none.
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
    narration: draft.source_narration,
    ...moneyFromColumns(draft),
    balance: null,
  }));
  const enrichment = gpayHtmlPath
    ? enrichWithGPay(sourceTransactions, parseGPayHtml(gpayHtmlPath))
    : { enriched: sourceTransactions, recipients: [], matchCount: 0 };

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
    sourceNarration: rows[index].transaction.narration,
    accountId: rows[index].accountId,
    comment: enrichment.recipients[index] ?? null,
  }));
  saveReclassifiedDrafts(db, reclassified, auth);

  const transactions: ClassifiedDraftTransaction[] = reclassified.map(
    ({ id, sourceNarration, accountId, comment }, index) => ({
      id,
      source_narration: sourceNarration,
      // As saved: the draft's own comment stays.
      comment: drafts[index].comment ?? comment ?? null,
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

export type SetDraftsAccountOutcome =
  | { kind: "set"; updated: number }
  | { kind: "account-not-found" }
  | { kind: "drafts-not-found"; ids: number[] }
  | { kind: "own-account" };

// Send every draft to the one account the user chose, or none of them when
// the account isn't in the books, a draft isn't, or the account is a draft's
// own base account.
export function setDraftsAccount(
  ledger: Ledger,
  ids: readonly number[],
  accountId: number,
): SetDraftsAccountOutcome {
  const checked = checkDraftsAccount(ledger, ids, accountId);
  if (checked.kind !== "valid") return checked;
  saveReclassifiedDrafts(
    ledger.db,
    checked.drafts.map((draft) => ({
      id: draft.id,
      sourceNarration: draft.source_narration,
      accountId,
    })),
    ledger.auth,
  );
  return { kind: "set", updated: checked.drafts.length };
}

// The drafts, when they may all go to the account: it is in the books, so is
// every draft, and it isn't a draft's own base account.
function checkDraftsAccount(
  ledger: Ledger,
  ids: readonly number[],
  accountId: number,
):
  | { kind: "valid"; drafts: ReturnType<typeof loadDraftsById> }
  | Exclude<SetDraftsAccountOutcome, { kind: "set" }> {
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
  | Exclude<SetDraftsAccountOutcome, { kind: "set" }>
  | { kind: "not-one-account" };

/**
 * Records that drafts of one statement account go to the account the user
 * chose, as a lesson for the coding agent to turn into a rule. The drafts
 * keep no account: the categorizer gives them one once the rule is in.
 */
export function teachCategorization(
  ledger: Ledger,
  lesson: { draftIds: readonly number[]; accountId: number; note: string },
): TeachCategorizationOutcome {
  const { auth } = ledger;
  return ledger.db.transaction((tx: any): TeachCategorizationOutcome => {
    const checked = checkDraftsAccount(
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
      transactions: checked.drafts
        .map((draft) => {
          const money = moneyFromColumns(draft);
          return {
            date: formatPlainDate(draft.date),
            source_narration: draft.source_narration,
            direction: direction(money),
            amount: amount(money),
          };
        })
        .sort((a, b) => a.date.localeCompare(b.date)),
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

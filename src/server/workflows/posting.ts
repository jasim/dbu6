import { postingBlocks, type PostingBlock } from "../../shared/index.js";
import { unsafeAsChrono } from "../modules/values/index.js";
import {
  deleteAccountDrafts,
  partitionByCategorization,
  loadCategorizedDrafts,
  draftCounts,
  loadDraftStatus,
} from "../modules/drafts/index.js";
import { planJournals } from "../modules/journal-plan/index.js";
import { insertJournalPlan } from "../modules/journals/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";

export type PostingOutcome =
  | { kind: "account-not-found" }
  // The first thing the draft status shows that keeps the drafts off the
  // books; nothing was written.
  | { kind: "blocked"; block: PostingBlock; baseAccountName: string }
  | {
      kind: "posted";
      baseAccountName: string;
      journalsCreated: number;
      entriesCreated: number;
      draftsPosted: number;
    };

/**
 * Adds one account's drafts to the books: a journal per date and type, the
 * drafts deleted. Refuses while the draft status shows anything that blocks.
 */
export function postDrafts(
  { db, sqlite, auth }: Ledger,
  baseAccountId: number,
): PostingOutcome {
  const loaded = loadCategorizedDrafts(db, baseAccountId, auth);
  if (loaded === null) return { kind: "account-not-found" };

  // The same blocks Review shows, so its ticks and this gate agree.
  const status = loadDraftStatus(sqlite, auth, {
    accountId: baseAccountId,
  }).get(baseAccountId);
  const [block] = postingBlocks(draftCounts(status));
  if (block) {
    return { kind: "blocked", block, baseAccountName: loaded.baseAccountName };
  }

  // The drafts and the status were read in one synchronous pass, so every
  // draft loaded here has a category.
  const { categorized, uncategorized } = partitionByCategorization([
    ...loaded.categorized,
  ]);
  if (uncategorized.length > 0) {
    throw new Error("Drafts changed while they were being posted.");
  }

  const plan = planJournals(
    unsafeAsChrono(
      categorized.map((draft) => ({
        transaction: draft.transaction,
        account: draft.accountId,
        assertion: draft.assertion,
      })),
    ),
    baseAccountId,
  );
  const inserted = db.transaction((tx: any) => {
    const written = insertJournalPlan(tx, plan, auth);
    deleteAccountDrafts(tx, baseAccountId, auth);
    return written;
  });

  return {
    kind: "posted",
    baseAccountName: loaded.baseAccountName,
    journalsCreated: inserted.journals,
    entriesCreated: inserted.entries,
    draftsPosted: loaded.drafts.length,
  };
}

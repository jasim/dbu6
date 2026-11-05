import {
  TsRestApi,
  type SapportaEnv,
  type ServerInferResponses,
} from "@sapporta/server";
import {
  draftTransactionsContract,
  type ImportInstitution,
  type PostingBlock,
} from "../../shared/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { loadImportPresets } from "../modules/import-presets/index.js";
import { accountNames } from "./account-names.js";
import {
  postDrafts,
  postPress,
  type BrokenCheck,
} from "../workflows/posting.js";
import { writeCommentsSoon } from "../workflows/comment-writer.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "postDraftsToJournal",
  draftTransactionsContract.postDraftsToJournal,
  async ({ c, request }) => {
    const ledger = requireWorkflowLedger(c);
    return postDraftsToJournal(
      ledger,
      request.body.base_account_id,
      loadImportPresets(ledger.db, ledger.auth),
    );
  },
);

api.register(
  "postReadyDrafts",
  draftTransactionsContract.postReadyDrafts,
  async ({ c, request }) => {
    const ledger = requireWorkflowLedger(c);
    return postReadyDraftsToJournal(
      ledger,
      request.body.base_account_ids,
      loadImportPresets(ledger.db, ledger.auth),
    );
  },
);

export default api;

type PostingResponse = ServerInferResponses<
  typeof draftTransactionsContract.postDraftsToJournal,
  200 | 404 | 422
>;

/**
 * Posts one account's drafts, answered in the contract's terms, the accounts
 * named as the presets' `institutions` name them.
 */
export function postDraftsToJournal(
  ledger: Ledger,
  base_account_id: number,
  institutions: readonly ImportInstitution[],
): PostingResponse {
  const names = accountNames(ledger.sqlite, ledger.auth, institutions);
  const outcome = postDrafts(ledger, base_account_id, names);
  // Entries posted after the writer's last run get their comments now.
  if (outcome.kind === "posted") writeCommentsSoon();
  switch (outcome.kind) {
    case "account-not-found":
      return { status: 404, body: { error: "Base account not found" } };
    case "breaks-posted-checks":
      return brokenChecksRefusal(outcome.broken);
    case "blocked":
      return refusal(outcome.block, outcome.baseAccountName);
    case "posted":
      return {
        status: 200,
        body: {
          base_account: outcome.baseAccountName,
          journals_created: outcome.journalsCreated,
          entries_created: outcome.entriesCreated,
          drafts_posted: outcome.draftsPosted,
          first_post: outcome.firstPost,
        },
      };
  }
}

type PostReadyResponse = ServerInferResponses<
  typeof draftTransactionsContract.postReadyDrafts,
  200 | 404 | 422
>;

/**
 * Add all: posts the accounts of `base_account_ids` that can go in
 * together, in one transaction, answered with what was added and what was
 * left and why, the accounts named as the presets' `institutions` name them.
 */
export function postReadyDraftsToJournal(
  ledger: Ledger,
  base_account_ids: readonly number[],
  institutions: readonly ImportInstitution[],
): PostReadyResponse {
  const names = accountNames(ledger.sqlite, ledger.auth, institutions);
  const outcome = postPress(ledger, base_account_ids, names);
  if (outcome.kind === "accounts-not-found") {
    return {
      status: 404,
      body: { error: `Accounts not found: ${outcome.accountIds.join(", ")}` },
    };
  }
  if (outcome.kind === "breaks-posted-checks") {
    return brokenChecksRefusal(outcome.broken);
  }
  // One run of the writer for every account the batch posted.
  if (outcome.posted.length > 0) writeCommentsSoon();
  return {
    status: 200,
    body: {
      posted: outcome.posted.map(({ accountId, name, draftsPosted }) => ({
        account_id: accountId,
        name,
        drafts_posted: draftsPosted,
      })),
      left: outcome.left.map(({ accountId, name, block }) => ({
        account_id: accountId,
        name,
        block,
      })),
      first_post: outcome.firstPost,
    },
  };
}

/**
 * The 422 for a post the books' own balance checks would miss: nothing was
 * added, and each account it would break is named.
 */
function brokenChecksRefusal(broken: readonly BrokenCheck[]) {
  const failures = broken.reduce((sum, one) => sum + one.failures, 0);
  const names = broken.map((one) => one.name).join(", ");
  return {
    status: 422 as const,
    body: {
      error: `Adding these would leave ${failures} balance check(s) in the books failing, on ${names}. Nothing was added.`,
      code: "POSTED_CHECKS_WOULD_FAIL",
      failing_count: failures,
    },
  };
}

/** The 422 for the first block, in the codes and counts callers read. */
function refusal(block: PostingBlock, account: string): PostingResponse {
  switch (block.kind) {
    case "categorization":
      // A draft on its own statement's account has an account_id, so it is
      // named apart: posting it would write both its lines on that account.
      if (block.on_own_account > 0) {
        return {
          status: 422,
          body: {
            error: `${block.on_own_account} draft transaction(s) under ${account} have ${account} itself as their account_id; give them the other side of the transaction`,
            code: "DRAFTS_ON_OWN_ACCOUNT",
            uncategorized_count: block.count,
            on_own_account_count: block.on_own_account,
          },
        };
      }
      return {
        status: 422,
        body: {
          error: `${block.count} draft transaction(s) under ${account} have no account_id`,
          code: "UNCATEGORIZED_DRAFTS",
          uncategorized_count: block.count,
        },
      };
    case "duplicates":
      return {
        status: 422,
        body: {
          error: `${block.count} duplicate draft overlap(s) found under ${account}`,
          code: "DUPLICATE_DRAFTS",
          duplicate_count: block.count,
        },
      };
    case "balance-checks": {
      const names = block.relies_on.map((other) => other.name).join(", ");
      return {
        status: 422,
        body: {
          error:
            names === ""
              ? `${block.count} draft balance assertion(s) failing under ${account}`
              : `${block.count} draft balance assertion(s) failing under ${account} without the drafts of ${names}. Add all adds them together.`,
          code: "FAILING_ASSERTIONS",
          failing_count: block.count,
          relies_on: block.relies_on,
        },
      };
    }
  }
}

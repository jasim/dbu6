import {
  TsRestApi,
  type SapportaEnv,
  type ServerInferResponses,
} from "@sapporta/server";
import { draftTransactionsContract, type PostingBlock } from "dbu6-shared";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { postDrafts } from "../workflows/posting.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "postDraftsToJournal",
  draftTransactionsContract.postDraftsToJournal,
  async ({ c, request }) => {
    return postDraftsToJournal(
      requireWorkflowLedger(c),
      request.body.base_account_id,
    );
  },
);

export default api;

type PostingResponse = ServerInferResponses<
  typeof draftTransactionsContract.postDraftsToJournal,
  200 | 404 | 422
>;

/** Posts one account's drafts, answered in the contract's terms. */
export function postDraftsToJournal(
  ledger: Ledger,
  base_account_id: number,
): PostingResponse {
  const outcome = postDrafts(ledger, base_account_id);
  switch (outcome.kind) {
    case "account-not-found":
      return { status: 404, body: { error: "Base account not found" } };
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
        },
      };
  }
}

/** The 422 for the first block, in the codes and counts callers read. */
function refusal(block: PostingBlock, account: string): PostingResponse {
  switch (block.kind) {
    case "categories":
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
    case "balance-checks":
      return {
        status: 422,
        body: {
          error: `${block.count} draft balance assertion(s) failing under ${account}`,
          code: "FAILING_ASSERTIONS",
          failing_count: block.count,
        },
      };
  }
}

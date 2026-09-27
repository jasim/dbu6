import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { draftTransactionsContract } from "../../shared/index.js";
import { setDraftsAccount } from "../workflows/reclassification.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

// Choosing an account by hand for many drafts at once, from Review's Improve
// categorization tab.
const api = new TsRestApi<SapportaEnv>();

api.register(
  "setDraftsAccount",
  draftTransactionsContract.setDraftsAccount,
  async ({ c, request }) => {
    const { ids, account_id } = request.body;
    const outcome = setDraftsAccount(requireWorkflowLedger(c), ids, account_id);
    switch (outcome.kind) {
      case "set":
        return { status: 200, body: { updated: outcome.updated } };
      case "account-not-found":
        return { status: 404, body: { error: "Account not found" } };
      case "drafts-not-found":
        return {
          status: 404,
          body: { error: `Drafts not found: ${outcome.ids.join(", ")}` },
        };
      case "own-account":
        return {
          status: 422,
          body: {
            error: "A draft can't go to the account its statement belongs to",
          },
        };
    }
  },
);

export default api;

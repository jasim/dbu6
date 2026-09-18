import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { draftTransactionsContract } from "dbu6-shared";
import {
  formatHledger,
  groupByDateAndType,
  hledgerFromGroups,
} from "../modules/journal-plan/index.js";
import { loadCategorizedDrafts } from "../modules/drafts/index.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "renderDraftHledger",
  draftTransactionsContract.renderDraftHledger,
  ({ c, request }) => {
    const auth = requireWorkflowAuth(c);
    const { base_account_id } = request.query;
    const loaded = loadCategorizedDrafts(c.get("db"), base_account_id, auth);
    if (loaded === null) {
      return { status: 404, body: { error: "Base account not found" } };
    }

    const groups = groupByDateAndType(loaded.categorized);
    const journal = hledgerFromGroups(groups, loaded.baseAccount);

    return {
      status: 200,
      body: {
        hledger_journal: formatHledger(journal),
        transaction_count: loaded.drafts.length,
        base_account: loaded.baseAccountName,
      },
    };
  },
);

export default api;

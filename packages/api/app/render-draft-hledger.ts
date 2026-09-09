import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { draftTransactionsContract } from "dbu6-shared";
import { groupByDateAndType } from "../bank-importer/domain/TransactionGroup.js";
import { fromGroups, format } from "../bank-importer/domain/HledgerJournal.js";
import { loadCategorizedDrafts } from "./draft-categorization.js";
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
    const journal = fromGroups(groups, loaded.baseAccount);

    return {
      status: 200,
      body: {
        hledger_journal: format(journal),
        transaction_count: loaded.drafts.length,
        base_account: loaded.baseAccountName,
      },
    };
  },
);

export default api;

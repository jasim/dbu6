import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { journalsContract } from "dbu6-shared";
import { renderVisibleJournalsAsHledger } from "../modules/journals/index.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "renderHledger",
  journalsContract.renderHledger,
  ({ c, request }) => {
    const auth = requireWorkflowAuth(c);
    const result = renderVisibleJournalsAsHledger({
      db: c.get("db"),
      auth,
      journalIds: request.body.journal_ids,
    });

    return {
      status: 200,
      body: result,
    };
  },
);

export default api;

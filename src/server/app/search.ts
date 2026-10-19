import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { searchContract } from "../../shared/index.js";
import { searchBooks } from "../modules/search/index.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

/*
 * The Search page's one request: what in the books matches every word of q.
 */

const api = new TsRestApi<SapportaEnv>();

api.register("search", searchContract.search, ({ c, request }) => {
  requireWorkflowAuth(c);
  return {
    status: 200,
    body: searchBooks(
      c.get("db"),
      c.get("sqlite"),
      c.get("auth"),
      request.query.q,
    ),
  };
});

export default api;

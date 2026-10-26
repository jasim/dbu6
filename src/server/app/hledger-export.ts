import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { hledgerExportContract } from "../../shared/index.js";
import { exportHledgerBooks } from "../workflows/hledger-export.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

const api = new TsRestApi<SapportaEnv>();

// The owner's whole books as hledger files, for the browser to zip.
api.register("exportHledger", hledgerExportContract.exportHledger, ({ c }) => {
  const auth = requireWorkflowAuth(c);
  return {
    status: 200,
    body: exportHledgerBooks({ db: c.get("db"), auth }),
  };
});

export default api;

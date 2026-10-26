import { readFileSync } from "node:fs";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { hledgerExportContract } from "../../shared/index.js";
import { readOnlyLedger } from "../modules/ledger-sql/index.js";
import { packageDir } from "../paths.js";
import { exportHledgerBooks } from "../workflows/hledger-export.js";
import { expectedBalanceSheet } from "./hledger-export-expected.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

/** The packaged verify.py, shipped in the zip beside the journals. */
export function readVerifyScript(): string {
  return readFileSync(packageDir("hledger-export", "verify.py"), "utf8");
}

/**
 * The owner's whole books as hledger files, for the browser to zip, with
 * what hledger should find in them and the script that checks it.
 * `verifyScript` is the packaged verify.py, or a stand-in in tests.
 */
export function hledgerExportApi(
  verifyScript: () => string = readVerifyScript,
): TsRestApi<SapportaEnv> {
  const api = new TsRestApi<SapportaEnv>();
  api.register(
    "exportHledger",
    hledgerExportContract.exportHledger,
    ({ c }) => {
      const auth = requireWorkflowAuth(c);
      return {
        status: 200,
        body: exportHledgerBooks({
          db: c.get("db"),
          auth,
          balanceSheet: expectedBalanceSheet(
            readOnlyLedger(c.get("sqlite"), auth),
          ),
          verifyScript: verifyScript(),
          now: new Date().toISOString(),
          random: Math.random,
        }),
      };
    },
  );
  return api;
}

export default hledgerExportApi;

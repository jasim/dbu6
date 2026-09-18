import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  accountKindOf,
  importDraftsContract,
  type AbacusImportErrorBody,
  type AbacusImportRequest,
  type AbacusImportResult,
} from "dbu6-shared";
import { loadAccountsByName } from "../modules/accounts/index.js";
import type { LedgerAuth } from "../modules/ledger-sql/index.js";
import { importFreeformStatement } from "../workflows/statement-import/index.js";
import { respondWithImportErrors } from "./import-error-response.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

// Import of one Abacus statement posted as JSON by a coding agent, for
// freeform transactions (custom-built-parsers/freeform-transactions-guide.md).
// The workflow checks the account and the statement's balances, then imports.
//
// Everything the import needs is in the request, so no import preset is
// involved. The response is raw data for the agent to explain: the
// per-account result the automatic import reports, or the import error's own
// payload.

type AbacusImportRouteResponse =
  | { status: 200; body: AbacusImportResult }
  | { status: 400; body: AbacusImportErrorBody }
  | { status: 422; body: AbacusImportErrorBody };

const DEFAULT_SOURCE_NAME = "freeform transactions";

export async function importAbacusStatement(
  request: AbacusImportRequest,
  accountNames: ReadonlySet<string>,
  db: unknown,
  auth: LedgerAuth,
): Promise<AbacusImportRouteResponse> {
  const { base_account, is_credit_card, statement } = request;
  const sourceName = request.source_name ?? DEFAULT_SOURCE_NAME;
  const response = await respondWithImportErrors(() =>
    importFreeformStatement(
      {
        baseAccount: base_account,
        accountKind: accountKindOf(is_credit_card),
        statement,
        sourceName,
      },
      accountNames,
      db,
      auth,
    ),
  );
  if (response.status !== 200) return response;
  const outcome = response.body;
  switch (outcome.kind) {
    case "account-not-found":
      return {
        status: 422,
        body: {
          error: "import_account_not_found",
          message: `The ledger has no account named ${base_account}.`,
          hint: "Use the account exactly as the prompt names it.",
        },
      };
    case "imported":
      return {
        status: 200,
        body: {
          base_account,
          is_credit_card,
          file_names: [sourceName],
          result: outcome.result,
        },
      };
  }
}

const api = new TsRestApi<SapportaEnv>();

api.register(
  "importAbacusStatement",
  importDraftsContract.importAbacusStatement,
  async ({ c, request }) => {
    const db = c.get("db");
    const auth = requireWorkflowAuth(c);
    return importAbacusStatement(
      request.body,
      new Set(loadAccountsByName(db, auth).keys()),
      db,
      auth,
    );
  },
);

export default api;

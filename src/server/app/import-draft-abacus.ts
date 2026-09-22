import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  accountKindOf,
  importDraftsContract,
  type AbacusImportRequest,
  type AbacusImportResult,
  type StatementImportError,
} from "../../shared/index.js";
import type { LoadCategorizer } from "../modules/categorization/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { importFreeformStatement } from "../workflows/statement-import/index.js";
import { respondWithImportErrors } from "./import-error-response.js";
import { requireWorkflowLedger } from "./workflow-auth.js";

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
  | { status: 400; body: StatementImportError }
  | { status: 422; body: StatementImportError };

const DEFAULT_SOURCE_NAME = "freeform transactions";

export async function importAbacusStatement(
  request: AbacusImportRequest,
  ledger: Ledger,
  loadCategorizer: LoadCategorizer,
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
      ledger,
      loadCategorizer,
    ),
  );
  if (response.status !== 200) return response;
  return {
    status: 200,
    body: {
      base_account,
      is_credit_card,
      file_names: [sourceName],
      result: response.body,
    },
  };
}

export default function importDraftAbacusApi(
  loadCategorizer: LoadCategorizer,
): TsRestApi<SapportaEnv> {
  const api = new TsRestApi<SapportaEnv>();
  api.register(
    "importAbacusStatement",
    importDraftsContract.importAbacusStatement,
    async ({ c, request }) =>
      importAbacusStatement(
        request.body,
        requireWorkflowLedger(c),
        loadCategorizer,
      ),
  );
  return api;
}

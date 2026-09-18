import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  accountKindOf,
  importDraftsContract,
  type AbacusImportErrorBody,
  type AbacusImportRequest,
  type AbacusImportResult,
} from "dbu6-shared";
import {
  abacusStatementFromJson,
  verifyDeclaredBalances,
} from "../modules/statement/index.js";
import { parseAccount } from "../modules/values/index.js";
import { loadAccountsByName } from "../bank-importer/draft-persistence.js";
import type { LedgerAuth } from "../modules/ledger-sql/index.js";
import { runStatementImport } from "../bank-importer/statement-import.js";
import { categorizationLlm } from "../coding-agent/categorization-llm.js";
import { respondWithImportErrors } from "./import-error-response.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

// Import of one Abacus statement posted as JSON by a coding agent, for
// freeform transactions (custom-built-parsers/freeform-transactions-guide.md).
//
//   the statement, with both balances -> BalancedStatement
//     -> verifyDeclaredBalances: the rows lead from the opening to the closing
//     -> runStatementImport([statement], the account and kind the user chose)
//
// Everything the import needs is in the request, so no import preset is
// involved: freeform rows are categorized without a preset's custom mappings.
// The contract requires the opening and closing balances, and the parsed
// statement keeps them in its type, so the rows are checked against both
// before anything is saved. The response is raw data for the agent to
// explain: the per-account result the automatic import reports, or the
// import error's own payload.

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
  // The drafts would otherwise be saved with no base account at all.
  if (!accountNames.has(base_account)) {
    return {
      status: 422,
      body: {
        error: "import_account_not_found",
        message: `The ledger has no account named ${base_account}.`,
        hint: "Use the account exactly as the prompt names it.",
      },
    };
  }

  const sourceName = request.source_name ?? DEFAULT_SOURCE_NAME;
  console.log(
    `[abacus-import] ${statement.rows.length} row(s) from ${JSON.stringify(sourceName)} into ${base_account}`,
  );
  const llm = await categorizationLlm();
  const response = await respondWithImportErrors(() => {
    const balanced = abacusStatementFromJson(statement);
    verifyDeclaredBalances(balanced);
    return runStatementImport(
      [balanced],
      {
        baseAccount: parseAccount(base_account),
        accountKind: accountKindOf(is_credit_card),
        customMappingsFilenames: [],
        gpayHtmlPath: null,
        llm,
      },
      db,
      auth,
      [sourceName],
    );
  });
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

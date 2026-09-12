import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  importDraftsContract,
  type AbacusImportRequest,
  type AutoImportGroupResult,
} from "dbu6-shared";
import { abacusStatementFromJson } from "../bank-importer/abacus/index.js";
import type { RowScopeAuth } from "../bank-importer/draft-persistence.js";
import {
  importOptionsFromPreset,
  readImportPresets,
  resolveNamedImportPreset,
  type ImportPreset,
} from "../bank-importer/import-presets.js";
import { runStatementImport } from "../bank-importer/statement-import.js";
import { respondWithImportErrors } from "./import-error-response.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

// Import of one Abacus statement posted as JSON by a coding agent, for
// freeform transactions (custom-built-parsers/freeform-transactions-guide.md).
//
//   resolveNamedImportPreset(presets, request.preset, statement.account)
//     -> runStatementImport([statement], importOptionsFromPreset(preset))
//
// The contract requires the opening and closing balances, so the rows are
// always checked against both before anything is saved. The response is raw
// data for the agent to explain: the per-account result the automatic import
// reports, or the import error's own payload.

type ImportErrorBody = {
  error: string;
  message?: string;
  detail?: string;
  hint?: string;
} & Record<string, unknown>;

type AbacusImportRouteResponse =
  | { status: 200; body: AutoImportGroupResult }
  | { status: 400; body: ImportErrorBody }
  | { status: 422; body: ImportErrorBody };

const DEFAULT_SOURCE_NAME = "freeform transactions";

export async function importAbacusStatement(
  request: AbacusImportRequest,
  presets: readonly ImportPreset[],
  db: unknown,
  auth: RowScopeAuth,
): Promise<AbacusImportRouteResponse> {
  const { statement } = request;
  const resolution = resolveNamedImportPreset(
    presets,
    request.preset,
    statement.account ?? null,
  );
  if (!resolution.ok) {
    return {
      status: 422,
      body:
        resolution.reason === "import_preset_not_found"
          ? {
              error: resolution.reason,
              message: resolution.message,
              preset_names: resolution.presetNames,
              hint: "Use the name of an entry in data/user-config/import-presets.json, or add one for this account.",
            }
          : {
              error: resolution.reason,
              message: resolution.message,
              expected_identifier: resolution.expectedIdentifier,
              statement_identifier: resolution.statementIdentifier,
              hint: "Check that the transactions belong to this preset's account; if they do, correct statement.account.",
            },
    };
  }

  const { preset } = resolution;
  const sourceName = request.source_name ?? DEFAULT_SOURCE_NAME;
  console.log(
    `[abacus-import] ${statement.rows.length} row(s) from ${JSON.stringify(sourceName)} into ${preset.name}`,
  );
  const response = await respondWithImportErrors(() =>
    runStatementImport(
      [abacusStatementFromJson(statement)],
      importOptionsFromPreset(preset, null),
      db,
      auth,
      [sourceName],
    ),
  );
  if (response.status !== 200) return response;
  return {
    status: 200,
    body: {
      preset_name: preset.name,
      base_account: preset.base_account,
      is_credit_card: preset.is_credit_card ?? false,
      file_names: [sourceName],
      result: response.body,
    },
  };
}

const api = new TsRestApi<SapportaEnv>();

api.register(
  "importAbacusStatement",
  importDraftsContract.importAbacusStatement,
  async ({ c, request }) =>
    importAbacusStatement(
      request.body,
      await readImportPresets(),
      c.get("db"),
      requireWorkflowAuth(c),
    ),
);

export default api;

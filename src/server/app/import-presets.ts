import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  importPresetsContract,
  type ImportPresetChange,
  type ImportPresetRefusal,
  type ImportPresetsFileConversionBody,
  type ImportPresetsFileRefusal as ImportPresetsFileRefusalBody,
  type ImportPresetsView,
} from "../../shared/index.js";
import { readCustomMappingsFile } from "../modules/categorization/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import {
  changeImportPresets,
  convertImportPresetsFileInto,
  loadImportPresetsView,
} from "../workflows/import-presets.js";
import { requireOwner, requireWorkflowLedger } from "./workflow-auth.js";

/*
 * The import presets: reading them, and the one route that changes them.
 * Coding agents change them with `sapporta api post /api/import-presets/changes`.
 */

const api = new TsRestApi<SapportaEnv>();

api.register(
  "listImportPresets",
  importPresetsContract.listImportPresets,
  async ({ c }) => ({
    status: 200,
    body: loadImportPresetsView(requireWorkflowLedger(c)),
  }),
);

api.register(
  "changeImportPresets",
  importPresetsContract.changeImportPresets,
  async ({ c, request }) =>
    changeImportPresetsResponse(requireWorkflowLedger(c), request.body.changes),
);

api.register(
  "convertImportPresetsFile",
  importPresetsContract.convertImportPresetsFile,
  async ({ c, request }) =>
    convertImportPresetsFileResponse(
      requireWorkflowLedger(c),
      request.body.apply,
    ),
);

api.register(
  "readCustomMappingsFile",
  importPresetsContract.readCustomMappingsFile,
  async ({ c, request }) => {
    requireOwner(c);
    return {
      status: 200,
      body: {
        filename: request.params.filename,
        content: readCustomMappingsFile(request.params.filename),
      },
    };
  },
);

export default api;

export async function changeImportPresetsResponse(
  ledger: Ledger,
  changes: readonly ImportPresetChange[],
): Promise<
  | { status: 200; body: ImportPresetsView }
  | { status: 422; body: ImportPresetRefusal }
> {
  const outcome = await changeImportPresets(ledger, changes);
  if (outcome.ok) return { status: 200, body: outcome.presets };
  return {
    status: 422,
    body: {
      error: outcome.problem.message,
      code: outcome.problem.code,
      change_index: outcome.problem.changeIndex,
    },
  };
}

export async function convertImportPresetsFileResponse(
  ledger: Ledger,
  apply: boolean,
): Promise<
  | { status: 200; body: ImportPresetsFileConversionBody }
  | { status: 404; body: { error: string; code: "no_presets_file" } }
  | { status: 422; body: ImportPresetsFileRefusalBody }
> {
  const outcome = await convertImportPresetsFileInto(ledger, { apply });
  if (outcome.ok) {
    return {
      status: 200,
      body: {
        applied: outcome.applied,
        institutions: outcome.institutions,
        warnings: outcome.warnings,
      },
    };
  }
  const { refusal } = outcome;
  switch (refusal.code) {
    case "no_presets_file":
      return {
        status: 404,
        body: { error: refusal.message, code: refusal.code },
      };
    case "unresolved_base_accounts":
    case "conflicting_is_credit_card":
      return {
        status: 422,
        body: {
          error: refusal.message,
          code: refusal.code,
          names: refusal.names,
        },
      };
    case "presets_already_in_table":
    case "read_back_mismatch":
      return {
        status: 422,
        body: { error: refusal.message, code: refusal.code },
      };
    default:
      return {
        status: 422,
        body: {
          error: refusal.message,
          code: refusal.code,
          change_index: refusal.changeIndex,
        },
      };
  }
}

import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import {
  importPresetsContract,
  type ImportPresetChange,
  type ImportPresetRefusal,
  type ImportPresetsView,
} from "../../shared/index.js";
import { readCustomMappingsFile } from "../modules/categorization/index.js";
import type { Ledger } from "../modules/ledger-sql/index.js";
import { readImportPresets } from "../modules/statement-sources/index.js";
import {
  changeImportPresets,
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
  "listImportPresetFile",
  importPresetsContract.listImportPresetFile,
  async ({ c }) => {
    requireOwner(c);
    return { status: 200, body: await readImportPresets() };
  },
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

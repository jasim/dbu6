import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { importPresetsContract } from "dbu6-shared";
import { readImportPresets } from "../bank-importer/import-presets.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "listImportPresets",
  importPresetsContract.listImportPresets,
  async ({ c }) => {
    requireWorkflowAuth(c);
    return { status: 200, body: await readImportPresets() };
  },
);

export default api;

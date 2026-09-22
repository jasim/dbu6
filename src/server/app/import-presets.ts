import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { importPresetsContract } from "../../shared/index.js";
import { readImportPresets } from "../modules/statement-sources/index.js";
import { requireOwner } from "./workflow-auth.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "listImportPresets",
  importPresetsContract.listImportPresets,
  async ({ c }) => {
    requireOwner(c);
    return { status: 200, body: await readImportPresets() };
  },
);

export default api;

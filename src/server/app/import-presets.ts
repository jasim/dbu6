import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { importPresetsContract } from "../../shared/index.js";
import { readCustomMappingsFile } from "../modules/categorization/index.js";
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

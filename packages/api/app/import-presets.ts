import { readFile } from "node:fs/promises";
import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { userConfigPath } from "../user-data.js";
import { importPresetSchema, importPresetsContract } from "dbu6-shared";
import { z } from "zod";
import { requireWorkflowAuth } from "./workflow-auth.js";

const api = new TsRestApi<SapportaEnv>();
const presetsSchema = z.array(importPresetSchema);

api.register(
  "listImportPresets",
  importPresetsContract.listImportPresets,
  async ({ c }) => {
    requireWorkflowAuth(c);
    const file = userConfigPath("import-presets.json");
    try {
      const raw = await readFile(file, "utf8");
      return { status: 200, body: presetsSchema.parse(JSON.parse(raw)) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: 200, body: [] };
      }
      throw err;
    }
  },
);

export default api;

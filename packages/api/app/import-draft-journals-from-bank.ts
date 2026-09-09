import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { importDraftsContract } from "dbu6-shared";
import { ApiImportError } from "../bank-importer/freeform-import.js";
import { runFederalImport } from "../bank-importer/federal-import.js";
import { runHdfcImport } from "../bank-importer/hdfc-import.js";
import { uploadedFile, withTempUpload, withTempUploads } from "./upload-tmp.js";
import { requireWorkflowAuth } from "./workflow-auth.js";

const api = new TsRestApi<SapportaEnv>();

api.register(
  "uploadHdfcStatement",
  importDraftsContract.uploadHdfcStatement,
  async ({ c, files }) => {
    const auth = requireWorkflowAuth(c);
    const file = uploadedFile(files, "file");
    if (!file) {
      return { status: 400, body: { error: "Missing file upload" } };
    }
    const ext = file.name.endsWith(".xlsx") ? ".xlsx" : ".xls";
    try {
      const result = await withTempUpload(file, "hdfc-upload", ext, (path) =>
        runHdfcImport(path, c.get("db"), auth),
      );
      return { status: 200, body: result };
    } catch (err) {
      if (err instanceof ApiImportError) {
        return c.json(err.toPayload(), err.status as any);
      }
      throw err;
    }
  },
);

api.register(
  "uploadFederalStatement",
  importDraftsContract.uploadFederalStatement,
  async ({ c, files }) => {
    const auth = requireWorkflowAuth(c);
    const file = uploadedFile(files, "file");
    if (!file) {
      return { status: 400, body: { error: "Missing file upload" } };
    }
    const gpay = uploadedFile(files, "gpay");
    try {
      if (!gpay) {
        const ext = file.name.endsWith(".xlsx") ? ".xlsx" : ".xls";
        const result = await withTempUpload(
          file,
          "federal-upload",
          ext,
          (path) => runFederalImport(path, c.get("db"), auth),
        );
        return { status: 200, body: result };
      }
      const result = await withTempUploads(
        [file, gpay],
        "federal-upload",
        (_workDir, [xlsPath, gpayPath]) =>
          runFederalImport(xlsPath, c.get("db"), auth, gpayPath),
      );
      return { status: 200, body: result };
    } catch (err) {
      if (err instanceof ApiImportError) {
        return c.json(err.toPayload(), err.status as any);
      }
      throw err;
    }
  },
);

export default api;

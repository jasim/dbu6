import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { categorizationLlm } from "../coding-agent/categorization-llm.js";
import { userConfigDir } from "../user-data.js";
import { draftTransactionsContract } from "dbu6-shared";
import { ApiImportError } from "../bank-importer/import-errors.js";
import { classifyDraftTransactions } from "../modules/draft-transactions/classification.js";
import { requireWorkflowAuth } from "./workflow-auth.js";
import { uploadedFile, withTempUpload } from "./upload-tmp.js";

const api = new TsRestApi<SapportaEnv>();
api.register(
  "classifyDraftTransactions",
  draftTransactionsContract.classifyDraftTransactions,
  async ({ c, request }) => {
    const auth = requireWorkflowAuth(c);
    const { ids, custom_mappings_filenames } = request.body;
    try {
      const result = await classifyDraftTransactions({
        db: c.get("db"),
        auth,
        ids,
        categorizationConfig: {
          userConfigDir: userConfigDir(),
          customMappingsFilenames: custom_mappings_filenames ?? [],
          llm: await categorizationLlm(),
        },
      });
      return {
        status: 200,
        body: {
          transactions: result.transactions,
          categorization: result.categorization,
        },
      };
    } catch (err) {
      if (err instanceof ApiImportError && err.status === 400) {
        return { status: 400, body: err.toPayload() };
      }
      throw err;
    }
  },
);

api.register(
  "classifyDraftTransactionsWithGPay",
  draftTransactionsContract.classifyDraftTransactionsWithGPay,
  async ({ c, request, files }) => {
    const auth = requireWorkflowAuth(c);
    const gpay = uploadedFile(files, "gpay");
    if (!gpay) {
      return { status: 400, body: { error: "Missing GPay HTML upload" } };
    }

    try {
      const llm = await categorizationLlm();
      const result = await withTempUpload(
        gpay,
        "gpay-reclassify",
        ".html",
        (gpayHtmlPath) =>
          classifyDraftTransactions({
            db: c.get("db"),
            auth,
            ids: request.body.ids,
            categorizationConfig: {
              userConfigDir: userConfigDir(),
              customMappingsFilenames: request.body.custom_mappings_filenames,
              llm,
            },
            gpayHtmlPath,
          }),
      );
      return {
        status: 200,
        body: {
          transactions: result.transactions,
          gpay_enriched_count: result.gpayEnrichedCount,
          categorization: result.categorization,
        },
      };
    } catch (err) {
      if (err instanceof ApiImportError && err.status === 400) {
        return { status: 400, body: err.toPayload() };
      }
      throw err;
    }
  },
);

export default api;

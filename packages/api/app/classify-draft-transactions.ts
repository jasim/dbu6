import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { draftTransactionsContract } from "dbu6-shared";
import { CategorizationConfigError } from "../modules/categorization/index.js";
import { classifyDraftTransactions } from "../workflows/reclassification.js";
import { categorizationErrorResponse } from "./import-error-response.js";
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
        customMappingsFilenames: custom_mappings_filenames ?? [],
      });
      return {
        status: 200,
        body: {
          transactions: result.transactions,
          categorization: result.categorization,
          categorization_tally: result.categorizationTally,
        },
      };
    } catch (err) {
      if (err instanceof CategorizationConfigError) {
        return categorizationErrorResponse(err);
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
      const result = await withTempUpload(
        gpay,
        "gpay-reclassify",
        ".html",
        (gpayHtmlPath) =>
          classifyDraftTransactions({
            db: c.get("db"),
            auth,
            ids: request.body.ids,
            customMappingsFilenames: request.body.custom_mappings_filenames,
            gpayHtmlPath,
          }),
      );
      return {
        status: 200,
        body: {
          transactions: result.transactions,
          gpay_enriched_count: result.gpayEnrichedCount,
          categorization: result.categorization,
          categorization_tally: result.categorizationTally,
        },
      };
    } catch (err) {
      if (err instanceof CategorizationConfigError) {
        return categorizationErrorResponse(err);
      }
      throw err;
    }
  },
);

export default api;

import { TsRestApi, type SapportaEnv } from "@sapporta/server";
import { draftTransactionsContract } from "../../shared/index.js";
import {
  CategorizationConfigError,
  type LoadCategorizer,
} from "../modules/categorization/index.js";
import { classifyDraftTransactions } from "../workflows/reclassification.js";
import { categorizationErrorResponse } from "./import-error-response.js";
import { NOT_RUNNING, progressBoard } from "./import-progress.js";
import { requireWorkflowAuth } from "./workflow-auth.js";
import { uploadedFile, withTempUpload } from "./upload-tmp.js";

// The routes that categorize drafts again, on the categorizer the runtime
// names. A run sent with a `progress_id` says how far it has got to
// `classifyProgress` while it runs, as an import does (import-progress.ts).
export default function classifyDraftTransactionsApi(
  loadCategorizer: LoadCategorizer,
): TsRestApi<SapportaEnv> {
  const api = new TsRestApi<SapportaEnv>();
  const running = progressBoard();

  api.register(
    "classifyDraftTransactions",
    draftTransactionsContract.classifyDraftTransactions,
    async ({ c, request }) => {
      const auth = requireWorkflowAuth(c);
      const { ids, custom_mappings_filenames, progress_id } = request.body;
      const tracked = running.start(progress_id);
      try {
        const result = await classifyDraftTransactions({
          db: c.get("db"),
          auth,
          ids,
          customMappingsFilenames: custom_mappings_filenames ?? [],
          loadCategorizer,
          onProgress: tracked?.onProgress,
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
      } finally {
        tracked?.finish();
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

      const tracked = running.start(request.body.progress_id);
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
              loadCategorizer,
              onProgress: tracked?.onProgress,
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
      } finally {
        tracked?.finish();
      }
    },
  );

  api.register(
    "classifyProgress",
    draftTransactionsContract.classifyProgress,
    async ({ c, request }) => {
      requireWorkflowAuth(c);
      const progress = running.read(request.params.progressId);
      if (progress === undefined) return NOT_RUNNING;
      return { status: 200 as const, body: progress };
    },
  );

  return api;
}

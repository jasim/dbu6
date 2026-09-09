// Barrel for ts-rest contracts. Add one file per feature and re-export its
// router from here so `packages/shared/src/index.ts` can pick everything up in
// one place.

export { reportsContract } from "./reports.js";
export {
  importDraftsContract,
  importSummarySchema,
  freeformImportResultSchema,
  sameAccountSkipSchema,
} from "./import-drafts.js";
export {
  importPresetsContract,
  importPresetSchema,
  extractionToolSchema,
  type ExtractionTool,
} from "./import-presets.js";
export { draftTransactionsContract } from "./draft-transactions.js";
export { journalsContract } from "./journals.js";

// Barrel for ts-rest contracts. Add one file per feature and re-export its
// router from here so `packages/shared/src/index.ts` can pick everything up in
// one place.

export { reportsContract } from "./reports.js";
export {
  importDraftsContract,
  importSummarySchema,
  statementImportResultSchema,
  sameAccountSkipSchema,
  autoImportPlanFileSchema,
  autoImportGroupResultSchema,
  autoImportResultSchema,
  abacusImportResultSchema,
  autoImportErrorSchema,
  abacusImportErrorSchema,
  type AutoImportPlanFile,
  type AutoImportGroupResult,
  type AbacusImportResult,
  type AutoImportResult,
  type AutoImportFailedGroup,
  type AutoImportErrorBody,
  type AbacusImportErrorBody,
  type StatementImportResultBody,
} from "./import-drafts.js";
export {
  statementImportErrorSchema,
  type StatementImportError,
  type StatementImportErrorCode,
} from "./import-errors.js";
export {
  accountKindSchema,
  accountKindOf,
  accountKindOfType,
  LEDGER_ACCOUNT_TYPE,
  type AccountKind,
} from "./account-kind.js";
export {
  draftCountsSchema,
  NO_DRAFTS,
  postingBlocks,
  isProblem,
  findBlock,
  type DraftCounts,
  type PostingBlock,
  type ProblemBlock,
} from "./posting-blocks.js";
export {
  abacusImportRequestSchema,
  abacusJsonSchema,
  abacusRowSchema,
  depositMoneySchema,
  withdrawalMoneySchema,
  type AbacusImportRequest,
  type AbacusJson,
} from "./abacus.js";
export {
  importPresetsContract,
  importPresetSchema,
  type ImportPreset,
} from "./import-presets.js";
export {
  statementAccountSchema,
  statementAccountIdentifierSchema,
  statementAccountKindSchema,
  type StatementAccount,
  type StatementAccountKind,
} from "./statement-account.js";
export { draftTransactionsContract } from "./draft-transactions.js";
export { journalsContract } from "./journals.js";
export {
  homeContract,
  homeAccountSchema,
  homeSummarySchema,
  type HomeAccount,
  type HomeSummary,
} from "./home.js";
export {
  reviewContract,
  reviewAccountSchema,
  reviewAccountDetailSchema,
  reviewDuplicateSchema,
  reviewFailingCheckSchema,
  type ReviewAccount,
  type ReviewAccountDetail,
  type ReviewDuplicate,
  type ReviewFailingCheck,
} from "./review.js";

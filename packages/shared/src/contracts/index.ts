// Barrel for ts-rest contracts. Add one file per feature and re-export its
// router from here so `packages/shared/src/index.ts` can pick everything up in
// one place.

export {
  reportsContract,
  incomeExpensesAccountSchema,
  incomeExpensesSchema,
  type IncomeExpenses,
  type IncomeExpensesAccount,
} from "./reports.js";
export {
  importDraftsContract,
  importSummarySchema,
  categorizationEngineSchema,
  categorizationReportSchema,
  CATEGORIZATION_ENGINE_LABEL,
  type CategorizationEngine,
  type CategorizationReport,
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
  POSTING_CHECK_KINDS,
  postingCheck,
  postingChecks,
  postingBlocks,
  isBlock,
  isProblem,
  type DraftCounts,
  type PostingCheck,
  type PostingCheckKind,
  type PostingBlock,
  type ProblemBlock,
} from "./posting-checks.js";
export { datedBalanceSchema, type DatedBalance } from "./dated-balance.js";
export { dateSpanSchema, type DateSpan } from "./date-span.js";
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
export {
  agentModelSchema,
  agentModelsSchema,
  codingAgentContract,
  codingAgentSchema,
  codingAgentSettingsSchema,
  codingAgentStatusSchema,
  chooseCodingAgentRequestSchema,
  CODING_AGENT_LABEL,
  unavailableAgentModelSchema,
  type AgentModel,
  type AgentModels,
  type CodingAgent,
  type CodingAgentSettings,
  type CodingAgentStatus,
  type UnavailableAgentModel,
} from "./coding-agent.js";
export {
  agentHandoffContract,
  agentHandoffCapabilitiesSchema,
  agentHandoffRequestSchema,
  agentHandoffSchema,
  agentHandoffErrorSchema,
  type AgentHandoffCapabilities,
  type AgentHandoffRequest,
  type AgentHandoff,
  type AgentHandoffErrorBody,
} from "./agent-handoff.js";
export { journalsContract } from "./journals.js";
export {
  homeContract,
  homeAccountSchema,
  homeSummarySchema,
  type HomeAccount,
  type HomeLedgerAccount,
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

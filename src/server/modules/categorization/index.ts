// The categorization module: the mapping rules, the prompt, what
// categorization needs of an LLM, and turning its answer into a ledger
// account. Its top, `loadCategorizer`, reads the user's config; `categorize`
// applies it. Import from here rather than from the files.
export {
  categorize,
  tallyCategorization,
  type Categorization,
  type CategorizationOutcome,
  type CategorizationProgress,
  type OnCategorizationProgress,
  type CategorizationRow,
  type CategorizedRow,
  type Categorizer,
  type SameAccountSkip,
} from "./categorize.js";
export { categorizationIdle } from "./categorizing.js";
export type {
  AccountsByName,
  CategorizedTransaction,
} from "./CategorizedTransaction.js";
export type {
  CategorizationLlm,
  ListAnswer,
  ListAnswerRow,
  ListClient,
  ListRequest,
} from "./llm-categorization.js";
export {
  CategorizationConfigError,
  DEFAULT_CUSTOM_MAPPINGS_FILENAME,
  loadCategorizer,
  readAccountInstructions,
  readCustomMappingsFile,
  readTransactionMappings,
  TRANSACTION_MAPPINGS_FILENAME,
  writeCustomMappingsFileIfMissing,
  type AccountInstructions,
  type CategorizerSettings,
  type LoadCategorizer,
} from "./load-categorizer.js";

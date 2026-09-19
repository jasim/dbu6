// The categorization module: the mapping rules, the prompt, what
// categorization needs of an LLM, and turning its answer into a ledger
// account. Its top, `loadCategorizer`, reads the user's config; `categorize`
// applies it. Import from here rather than from the files.
export {
  categorize,
  tallyCategorization,
  type Categorization,
  type CategorizationOutcome,
  type CategorizationRow,
  type CategorizedRow,
  type Categorizer,
  type SameAccountSkip,
} from "./categorize.js";
export type {
  AccountsByName,
  CategorizedTransaction,
} from "./CategorizedTransaction.js";
export type {
  CategorizationLlm,
  ListAnswer,
  ListClient,
  ListRequest,
} from "./llm-categorization.js";
export {
  CategorizationConfigError,
  loadCategorizer,
  type CategorizerSettings,
} from "./load-categorizer.js";

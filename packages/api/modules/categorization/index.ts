// The categorization module: the mapping rules, the prompt, what
// categorization needs of an LLM, and turning its answer into an account.
// Import from here rather than from the files.
export {
  resolveAccountIdForCategorized,
  type CategorizedTransaction,
  type ResolvedAccountId,
} from "./CategorizedTransaction.js";
export type {
  CategorizationLlm,
  ListAnswer,
  ListClient,
  ListRequest,
} from "./llm-categorization.js";
export { resolveCategories, type CategorizationConfig } from "./resolve.js";

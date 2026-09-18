import type { CategorizationReport } from "dbu6-shared";
import type { Abacus } from "../modules/statement/index.js";
import {
  type Account,
  type Chrono,
  unsafeAsChrono,
} from "../modules/values/index.js";
import {
  formatHledger,
  groupByDateAndType,
  hledgerFromGroups,
} from "../modules/journal-plan/index.js";
import {
  type CategorizedTransaction,
  resolveCategories,
  type CategorizationConfig,
} from "../modules/categorization/index.js";

export interface PipelineConfig {
  baseAccount: Account;
  categorization: CategorizationConfig;
}

export interface PipelineResult {
  hledgerJournal: string;
  /** The categorized transactions before grouping — needed by callers that
   *  persist individual entries (e.g. draft journal creation). */
  categorized: Chrono<CategorizedTransaction>;
  /** How the LLM fared on what the mapping rules didn't categorize. */
  categorization: CategorizationReport;
}

/**
 * Process parsed bank transactions through the full pipeline:
 * categorize → group → format as hledger journal. The rows were checked
 * when their statement was parsed (`abacusStatementFromJson`).
 *
 * Callers are responsible for filtering out already-reconciled rows before
 * calling — this stage assumes everything it receives is in scope.
 */
export async function processStatement(
  transactions: Chrono<Abacus>,
  config: PipelineConfig,
): Promise<PipelineResult> {
  const resolved = await resolveCategories(
    [...transactions],
    config.categorization,
  );
  const categorized: Chrono<CategorizedTransaction> = unsafeAsChrono(
    resolved.categorized,
  );

  const groups = groupByDateAndType(categorized);
  const journal = hledgerFromGroups(groups, config.baseAccount);
  return {
    hledgerJournal: formatHledger(journal),
    categorized,
    categorization: resolved.report,
  };
}

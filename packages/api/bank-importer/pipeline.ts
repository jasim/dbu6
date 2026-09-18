import type { CategorizationReport } from "dbu6-shared";
import type { Abacus } from "../modules/statement/index.js";
import {
  type Account,
  type Chrono,
  unsafeAsChrono,
} from "../modules/values/index.js";
import { groupByDateAndType } from "./domain/TransactionGroup.js";
import { fromGroups, format } from "./domain/HledgerJournal.js";
import type { CategorizedTransaction } from "./domain/CategorizedTransaction.js";
import {
  resolveCategories,
  type CategorizationConfig,
} from "./categorization/resolve.js";

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
  const journal = fromGroups(groups, config.baseAccount);
  return {
    hledgerJournal: format(journal),
    categorized,
    categorization: resolved.report,
  };
}

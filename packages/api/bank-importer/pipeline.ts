import { validateTransactions, type Abacus } from "./abacus/index.js";
import type { Account } from "./domain/Account.js";
import { type Chrono, chronoMap, unsafeAsChrono } from "./domain/Chrono.js";
import { UNCATEGORIZED } from "./domain/Account.js";
import { groupByDateAndType } from "./domain/TransactionGroup.js";
import { fromGroups, format } from "./domain/HledgerJournal.js";
import type { CategorizedTransaction } from "./domain/CategorizedTransaction.js";
import {
  resolveCategories,
  type CategorizationConfig,
} from "./categorization/resolve.js";

export interface PipelineConfig {
  baseAccount: Account;
  categorization?: CategorizationConfig;
}

export interface PipelineResult {
  hledgerJournal: string;
  /** The categorized transactions before grouping — needed by callers that
   *  persist individual entries (e.g. draft journal creation). */
  categorized: Chrono<CategorizedTransaction>;
}

/**
 * Process parsed bank transactions through the full pipeline:
 * validate → categorize → group → format as hledger journal.
 *
 * Callers are responsible for filtering out already-reconciled rows before
 * calling — this stage assumes everything it receives is in scope.
 */
export async function processStatement(
  transactions: Chrono<Abacus>,
  config: PipelineConfig,
): Promise<PipelineResult> {
  validateTransactions(transactions);

  const categorized: Chrono<CategorizedTransaction> = config.categorization
    ? unsafeAsChrono(
        await resolveCategories([...transactions], config.categorization),
      )
    : chronoMap(transactions, (t) => ({
        transaction: t,
        account: UNCATEGORIZED as Account,
      }));

  const groups = groupByDateAndType(categorized);
  const journal = fromGroups(groups, config.baseAccount);
  return { hledgerJournal: format(journal), categorized };
}

import { z } from "zod";
import type { Abacus } from "./abacus/index.js";
import type { Account } from "./domain/Account.js";
import { type Chrono, chronoEmpty } from "./domain/Chrono.js";
import type { CategorizedTransaction } from "./domain/CategorizedTransaction.js";
import type { CategorizationConfig } from "./categorization/resolve.js";
import { processStatement } from "./pipeline.js";
import {
  toDraftRows,
  persistDrafts,
  type RowScopeAuth,
  sameAccountSkipSchema,
} from "./draft-persistence.js";

export const importSummarySchema = z.object({
  hledger_journal: z.string(),
  transaction_count: z.number(),
  skipped_reconciled_count: z.number(),
  draft_transaction_count: z.number(),
  duplicate_count: z.number(),
  draft_duplicate_count: z.number().default(0),
  journal_duplicate_count: z.number().default(0),
  legacy_match_count: z.number().default(0),
  backfilled_count: z.number(),
  same_account_skips: z.array(sameAccountSkipSchema),
});
export type ImportSummary = z.infer<typeof importSummarySchema>;

export interface DraftImportInput {
  baseAccount: Account;
  // Keyed and already filtered to what the ledger doesn't hold yet.
  transactions: Chrono<Abacus>;
  // How many rows the statement had before the reconciliation filter.
  rawTransactionCount: number;
  categorizationConfig: CategorizationConfig;
  logPrefix: string;
  db: any;
  auth?: RowScopeAuth;
}

// Shared tail of a statement import: categorize + format the new rows,
// persist them as drafts, return a summary. Assembly, keying, balance
// validation, and the reconciliation filter are `runStatementImport`'s job.
export async function runDraftImport(
  input: DraftImportInput,
): Promise<ImportSummary> {
  const {
    baseAccount,
    transactions: newTransactions,
    rawTransactionCount: rawCount,
    categorizationConfig,
    logPrefix,
    db,
    auth,
  } = input;

  // processStatement throws on empty input (validateTransactions), so the
  // short-circuit is load-bearing when reconciliation has consumed everything.
  const { hledgerJournal, categorized } =
    newTransactions.length === 0
      ? {
          hledgerJournal: "",
          categorized: chronoEmpty<CategorizedTransaction>(),
        }
      : await processStatement(newTransactions, {
          baseAccount,
          categorization: categorizationConfig,
        });

  const {
    rows: draftRows,
    sameAccountSkips,
    expectedClosingByDate,
  } = toDraftRows(db, baseAccount, categorized, auth);
  const persisted = persistDrafts(db, draftRows, expectedClosingByDate, auth);
  console.log(
    `[${logPrefix}] persisted: ${persisted.inserted} inserted, ${persisted.duplicates} duplicates, ${persisted.backfilled} backfilled`,
  );
  if (sameAccountSkips.length > 0) {
    console.log(
      `[${logPrefix}] same-account skips: ${sameAccountSkips.length} (LLM classified as base account; left uncategorized)`,
    );
  }

  return {
    hledger_journal: hledgerJournal,
    transaction_count: rawCount,
    skipped_reconciled_count: rawCount - newTransactions.length,
    draft_transaction_count: persisted.inserted,
    duplicate_count: persisted.duplicates,
    draft_duplicate_count: persisted.draftDuplicates,
    journal_duplicate_count: persisted.journalDuplicates,
    legacy_match_count: persisted.legacyMatches,
    backfilled_count: persisted.backfilled,
    same_account_skips: sameAccountSkips,
  };
}

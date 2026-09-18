import type { z } from "zod";
import type { importSummarySchema } from "dbu6-shared";
import type { Abacus } from "../modules/statement/index.js";
import type { Account, Chrono } from "../modules/values/index.js";
import type { CategorizationConfig } from "./categorization/resolve.js";
import { processStatement } from "./pipeline.js";
import {
  toDraftRows,
  persistDrafts,
  sameAccountSkipSchema,
} from "./draft-persistence.js";
import type { LedgerAuth } from "../modules/ledger-sql/index.js";

// What an import did, as the contract states it (dbu6-shared). Everything
// but the Google Pay count, which `runStatementImport` adds.
export type ImportSummary = Omit<
  z.infer<typeof importSummarySchema>,
  "gpay_enriched_count"
>;

export interface DraftImportInput {
  baseAccount: Account;
  // Keyed and already filtered to what the ledger doesn't hold yet.
  transactions: Chrono<Abacus>;
  // How many rows the statement had before the reconciliation filter.
  rawTransactionCount: number;
  categorizationConfig: CategorizationConfig;
  logPrefix: string;
  db: any;
  auth?: LedgerAuth;
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

  // With nothing new, this categorizes nothing and formats an empty journal.
  const { hledgerJournal, categorized, categorization } =
    await processStatement(newTransactions, {
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
    // Categorization runs before the duplicates are dropped, so a report is
    // only about this import when it created drafts.
    categorization: persisted.inserted > 0 ? categorization : null,
  };
}

import type { z } from "zod";
import type { importSummarySchema } from "dbu6-shared";
import type { Abacus } from "../../modules/statement/index.js";
import {
  type Account,
  type Chrono,
  chronoMap,
  unsafeAsChrono,
} from "../../modules/values/index.js";
import {
  categorize,
  type CategorizedRow,
  type Categorizer,
} from "../../modules/categorization/index.js";
import {
  formatHledger,
  planJournals,
} from "../../modules/journal-plan/index.js";
import { loadAccountsByName } from "../../modules/accounts/index.js";
import { toDraftRows, persistDrafts } from "../../modules/drafts/index.js";
import type { LedgerAuth } from "../../modules/ledger-sql/index.js";

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
  categorizer: Categorizer;
  logPrefix: string;
  db: any;
  auth: LedgerAuth;
}

// Shared tail of a statement import: categorize the new rows, format them as
// an hledger journal, persist them as drafts, return a summary. The rows were
// checked when their statement was parsed (`abacusStatementFromJson`).
// Assembly, keying, balance validation, and the reconciliation filter are
// `runStatementImport`'s job, so everything that arrives here is in scope.
export async function runDraftImport(
  input: DraftImportInput,
): Promise<ImportSummary> {
  const {
    baseAccount,
    transactions: newTransactions,
    rawTransactionCount: rawCount,
    categorizer,
    logPrefix,
    db,
    auth,
  } = input;

  const accountsByName = loadAccountsByName(db, auth);
  const baseAccountId = accountsByName.get(baseAccount)?.id ?? null;
  // With nothing new, this categorizes nothing and formats an empty journal.
  const categorization = await categorize(
    categorizer,
    newTransactions.map((transaction) => ({ transaction, baseAccountId })),
    accountsByName,
  );
  const categorized: Chrono<CategorizedRow> = unsafeAsChrono(
    categorization.rows,
  );
  const { sameAccountSkips } = categorization;
  // The statement's running balance after every row, so each group asserts
  // where it ends. Each row shows the account its answer named.
  const hledgerJournal = formatHledger(
    planJournals(
      chronoMap(categorized, ({ transaction, account }) => ({
        transaction,
        account,
        assertion: transaction.balance,
      })),
      baseAccount,
    ),
  );

  const { rows: draftRows, expectedClosingByDate } = toDraftRows(
    categorized,
    baseAccountId,
  );
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
    categorization: persisted.inserted > 0 ? categorization.report : null,
  };
}

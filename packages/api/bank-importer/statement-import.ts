import {
  accountKindOf,
  type AccountKind,
  type DatedBalance,
  type DateSpan,
  type ImportPreset,
} from "dbu6-shared";
import { userConfigDir } from "../user-data.js";
import type { CategorizationLlm } from "../modules/categorization/index.js";
import {
  type Account,
  parseAccount,
  unsafeAsChrono,
} from "../modules/values/index.js";
import { enrichWithGPayHtml } from "../modules/gpay/index.js";
import {
  assembleStatements,
  synthesizeRunningBalances,
  verifyClosingBalance,
  type AbacusStatement,
  OpeningBalanceUnavailable,
  ClosingBalanceUnavailable,
} from "../modules/statement/index.js";
import {
  lookupLastReconciled,
  newTransactionsSinceReconciliation,
} from "./draft-persistence.js";
import type { LedgerAuth } from "../modules/ledger-sql/index.js";
import { runDraftImport, type ImportSummary } from "./draft-import.js";
import { assignSourceTransactionKeys } from "../modules/transaction-identity/index.js";

export type BalanceSource = "statement" | "checkpoint" | "per-row" | "none";

export interface ResolvedBalance {
  value: number | null;
  source: BalanceSource;
}

export interface ImportOptions {
  baseAccount: Account;
  accountKind: AccountKind;
  customMappingsFilenames: string[];
  // Where categorization runs. The route resolves it, so nothing in the
  // pipeline reaches for the process's engine.
  llm: CategorizationLlm;
  // Path to a staged Google Pay Takeout HTML export. When set, withdrawals
  // that survive the reconciliation filter get their narration prefixed with
  // the GPay recipient before categorization. Applied after transaction keys
  // are assigned, so the takeout never changes transaction identity.
  gpayHtmlPath: string | null;
}

export interface StatementImportResult extends ImportSummary {
  gpay_enriched_count: number;
  // Null when the statement printed per-row balances — synthesis is skipped
  // in that case and no opening is needed.
  opening_balance: number | null;
  closing_balance_from_statement: number | null;
  balance_metadata: {
    opening: {
      extracted: number | null;
      effective: number | null;
      source: BalanceSource;
    };
    closing: {
      extracted: number | null;
      effective: number | null;
      source: BalanceSource;
    };
  };
  // First and last transaction dates of the assembled statement, before the
  // reconciliation filter; null when it has no rows.
  statement_period: DateSpan | null;
  // The ledger's last reconciled balance for the account, from which rows
  // count as new; null when the account has never been reconciled.
  reconciliation_checkpoint: DatedBalance | null;
}

// Pick opening balance by precedence: statement → reconciliation checkpoint.
//
// Why statement over checkpoint: the statement's opening is what it printed
// as its starting balance, so running the walk from it produces per-row
// balances that match the statement's own math. The checkpoint may
// legitimately differ (ledger activity between reconciliations that this
// statement doesn't cover) and is only a reasonable seed when the statement
// didn't print an opening.
//
// Returns source "none" with a null value when neither source has a value.
// Callers that truly need an opening (synthesis path) must reject; callers
// that don't (trust path, when the statement already has per-row balances)
// can proceed.
export function pickOpeningBalance(
  statementOpening: number | null,
  checkpointBalance: number | null,
): ResolvedBalance {
  if (statementOpening !== null)
    return { value: statementOpening, source: "statement" };
  if (checkpointBalance !== null)
    return { value: checkpointBalance, source: "checkpoint" };
  return { value: null, source: "none" };
}

export function pickClosingBalance(
  statementClosing: number | null,
  finalPrintedBalance: number | null,
): ResolvedBalance {
  if (statementClosing !== null)
    return { value: statementClosing, source: "statement" };
  if (finalPrintedBalance !== null)
    return { value: finalPrintedBalance, source: "per-row" };
  return { value: null, source: "none" };
}

// One account's statement parts → assembled, keyed, balance-validated
// statement → rows the ledger doesn't hold yet → drafts.
export async function runStatementImport(
  parts: AbacusStatement[],
  opts: ImportOptions,
  db: any,
  auth?: LedgerAuth,
  sourceNames: readonly string[] = [],
): Promise<StatementImportResult> {
  // Assemble first, key second. Keys number textually identical rows on one
  // day by occurrence, so two such rows that arrive one per part must be
  // numbered over the assembled sequence rather than collide at occurrence
  // 1 in each file. Keying still precedes the reconciliation filter below:
  // that filter trims mid-day at the checkpoint row, and keying after it
  // would renumber the checkpoint day depending on where the checkpoint fell.
  const assembled = assembleStatements(parts, sourceNames);
  const { opening, closing } = assembled;
  const transactions = assignSourceTransactionKeys(
    assembled.transactions,
    opts.baseAccount,
  );
  if (parts.length > 1) {
    console.log(
      `[statement-import] assembled ${transactions.length} transactions across ${parts.length} part(s): opening=${opening} (first part), closing=${closing} (last part)`,
    );
  } else {
    console.log(
      `[statement-import] single-part import: ${transactions.length} transactions, opening=${opening}, closing=${closing}`,
    );
  }

  const checkpoint = lookupLastReconciled(db, opts.baseAccount, auth);
  console.log(
    `[statement-import] reconciliation checkpoint for ${opts.baseAccount}: ${
      checkpoint
        ? `balance=${checkpoint.balance} as of ${checkpoint.date}`
        : "none"
    }`,
  );

  const noPrintedBalances = transactions.every((t) => t.balance === null);
  const allPrintedBalances = transactions.every((t) => t.balance !== null);
  const resolvedOpening = pickOpeningBalance(
    opening,
    checkpoint?.balance ?? null,
  );
  const finalPrintedBalance =
    transactions[transactions.length - 1]?.balance ?? null;
  const resolvedClosing = pickClosingBalance(closing, finalPrintedBalance);

  if (opts.accountKind === "card" && resolvedClosing.value === null) {
    throw new ClosingBalanceUnavailable();
  }

  if (allPrintedBalances) {
    console.log(
      `[statement-import] every row has a printed balance — trusting as-is`,
    );
  } else if (noPrintedBalances) {
    if (resolvedOpening.value === null) {
      throw new OpeningBalanceUnavailable();
    }
    console.log(
      `[statement-import] no printed balances — synthesizing from opening ${resolvedOpening.value} (source: ${resolvedOpening.source})`,
    );
  } else {
    const printedCount = transactions.filter((t) => t.balance !== null).length;
    console.log(
      `[statement-import] hybrid mode: ${printedCount}/${transactions.length} rows have printed balances; using them as checkpoints to fill the rest`,
    );
  }

  const withBalances = synthesizeRunningBalances(
    transactions,
    resolvedOpening.value,
  );

  const hint = noPrintedBalances
    ? "Did the uploaded statements cover every day from the statement opening through its closing, with no gaps? Missing activity makes the calculated balance drift from the statement's printed closing."
    : null;
  verifyClosingBalance(withBalances, resolvedClosing.value, hint);
  console.log(
    `[statement-import] complete statement balance validation passed before reconciliation filtering`,
  );

  const survivors = newTransactionsSinceReconciliation(
    withBalances,
    checkpoint,
    opening,
  );
  const filteredCount = withBalances.length - survivors.length;
  if (filteredCount > 0) {
    console.log(
      `[statement-import] reconciliation filter removed ${filteredCount} already-reconciled row(s); ${survivors.length} survivor(s) remain`,
    );
  }

  // GPay enrichment runs here on purpose: after `assignSourceTransactionKeys`
  // (so every survivor already carries its key and the takeout cannot change
  // identity) and after the reconciliation filter (so already-reconciled rows
  // do not consume activities a live row with the same date/amount needs).
  let importable = survivors;
  let gpayEnrichedCount = 0;
  if (opts.gpayHtmlPath && survivors.length > 0) {
    const enrichment = enrichWithGPayHtml(survivors, opts.gpayHtmlPath);
    importable = unsafeAsChrono(enrichment.enriched);
    gpayEnrichedCount = enrichment.matchCount;
    console.log(
      `[statement-import] GPay takeout: ${enrichment.indexSize} (date,amount) keys; enriched ${gpayEnrichedCount} of ${survivors.length} narration(s)`,
    );
  }

  if (importable.length > 0) {
    console.log(
      `[statement-import] handing ${importable.length} validated transactions to draft-import`,
    );
  } else {
    console.log(
      `[statement-import] entire validated statement already reconciled`,
    );
  }

  const summary = await runDraftImport({
    baseAccount: opts.baseAccount,
    transactions: importable,
    rawTransactionCount: withBalances.length,
    categorizationConfig: {
      userConfigDir: userConfigDir(),
      customMappingsFilenames: opts.customMappingsFilenames,
      llm: opts.llm,
    },
    logPrefix: "statement-import",
    db,
    auth,
  });

  console.log(
    `[statement-import] import complete: opening_balance=${resolvedOpening.value}, closing_balance_from_statement=${closing}, effective_closing=${resolvedClosing.value}`,
  );
  return {
    ...summary,
    gpay_enriched_count: gpayEnrichedCount,
    opening_balance: resolvedOpening.value,
    closing_balance_from_statement: closing,
    balance_metadata: {
      opening: {
        extracted: opening,
        effective: resolvedOpening.value,
        source: resolvedOpening.source,
      },
      closing: {
        extracted: closing,
        effective: resolvedClosing.value,
        source: resolvedClosing.source,
      },
    },
    statement_period:
      transactions.length === 0
        ? null
        : {
            first_date: transactions[0].date,
            last_date: transactions[transactions.length - 1].date,
          },
    reconciliation_checkpoint: checkpoint
      ? { date: checkpoint.date, balance: checkpoint.balance }
      : null,
  };
}

// How a preset decides an import. The Google Pay Takeout is the one choice
// made per upload rather than per account, so it arrives alongside.
export function importOptionsFromPreset(
  preset: ImportPreset,
  gpayHtmlPath: string | null,
  llm: CategorizationLlm,
): ImportOptions {
  return {
    baseAccount: parseAccount(preset.base_account),
    accountKind: accountKindOf(preset.is_credit_card),
    customMappingsFilenames: preset.custom_mappings_filenames,
    gpayHtmlPath,
    llm,
  };
}

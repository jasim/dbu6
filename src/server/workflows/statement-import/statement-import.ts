import {
  accountKindOf,
  type AccountKind,
  type DatedBalance,
  type DateSpan,
  type ImportPreset,
} from "../../../shared/index.js";
import type {
  CategorizationLlm,
  Categorizer,
  LoadCategorizer,
} from "../../modules/categorization/index.js";
import {
  type Account,
  parseAccount,
  unsafeAsChrono,
} from "../../modules/values/index.js";
import { enrichWithGPay, type GPayIndex } from "../../modules/gpay/index.js";
import {
  assembleStatements,
  synthesizeRunningBalances,
  verifyClosingBalance,
  type AbacusStatement,
  OpeningBalanceUnavailable,
  ClosingBalanceUnavailable,
} from "../../modules/statement/index.js";
import { newTransactionsSinceReconciliation } from "../../modules/reconciliation/index.js";
import {
  loadPostedRowsOn,
  lookupLastReconciled,
} from "../../modules/journals/index.js";
import { loadAccountsByName } from "../../modules/accounts/index.js";
import type { Ledger } from "../../modules/ledger-sql/index.js";
import { runDraftImport, type ImportSummary } from "./draft-import.js";
import { assignSourceTransactionKeys } from "../../modules/transaction-identity/index.js";

// The import names an account the ledger doesn't have, so its drafts would
// belong to no account.
export class AccountNotFoundError extends Error {
  override readonly name = "AccountNotFoundError";

  constructor(readonly account: string) {
    super(`The ledger has no account named ${account}.`);
  }
}

export type BalanceSource = "statement" | "checkpoint" | "per-row" | "none";

export interface ResolvedBalance {
  value: number | null;
  source: BalanceSource;
}

export interface ImportOptions {
  baseAccount: Account;
  accountKind: AccountKind;
  // The user's categorization config, with the preset's instructions, on the
  // engine the import runs on. The batch and freeform imports load it, so
  // nothing below them reads the user's files or reaches for the process's
  // engine.
  categorizer: Categorizer;
  // A Google Pay Takeout, parsed once by the batch. When set, withdrawals
  // that survive the reconciliation filter get their narration prefixed with
  // the GPay recipient before categorization. Applied after transaction keys
  // are assigned, so the takeout never changes transaction identity.
  gpay: GPayIndex | null;
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
  ledger: Ledger,
  sourceNames: readonly string[] = [],
): Promise<StatementImportResult> {
  // The drafts are the account's, so an account the ledger doesn't have
  // refuses the import before the statement is looked at.
  const accountsByName = loadAccountsByName(ledger.db, ledger.auth);
  const baseAccountId = accountsByName.get(opts.baseAccount)?.id;
  if (baseAccountId === undefined) {
    throw new AccountNotFoundError(opts.baseAccount);
  }

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

  const checkpoint = lookupLastReconciled(
    ledger.sqlite,
    ledger.auth,
    opts.baseAccount,
  );
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

  // With no printed balances to walk against, a drift at the closing most
  // likely means a missing period rather than a misread row.
  verifyClosingBalance(withBalances, resolvedClosing.value, noPrintedBalances);
  console.log(
    `[statement-import] complete statement balance validation passed before reconciliation filtering`,
  );

  const survivors = newTransactionsSinceReconciliation(
    withBalances,
    checkpoint,
    opening,
    checkpoint &&
      loadPostedRowsOn(
        ledger.sqlite,
        ledger.auth,
        baseAccountId,
        checkpoint.date,
      ),
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
  if (opts.gpay && survivors.length > 0) {
    const enrichment = enrichWithGPay(survivors, opts.gpay);
    importable = unsafeAsChrono(enrichment.enriched);
    gpayEnrichedCount = enrichment.matchCount;
    console.log(
      `[statement-import] GPay takeout: ${opts.gpay.size} (date,amount) keys; enriched ${gpayEnrichedCount} of ${survivors.length} narration(s)`,
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
    baseAccountId,
    accountsByName,
    transactions: importable,
    rawTransactionCount: withBalances.length,
    categorizer: opts.categorizer,
    logPrefix: "statement-import",
    db: ledger.db,
    auth: ledger.auth,
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

// How a preset decides an import, its categorization instructions included.
// The Google Pay Takeout is the one choice made per upload rather than per
// account, so it arrives alongside.
export async function importOptionsFromPreset(
  preset: ImportPreset,
  gpay: GPayIndex | null,
  llm: CategorizationLlm,
  loadCategorizer: LoadCategorizer,
): Promise<ImportOptions> {
  return {
    baseAccount: parseAccount(preset.base_account),
    accountKind: accountKindOf(preset.is_credit_card),
    categorizer: await loadCategorizer({
      customMappingsFilenames: preset.custom_mappings_filenames,
      llm,
    }),
    gpay,
  };
}

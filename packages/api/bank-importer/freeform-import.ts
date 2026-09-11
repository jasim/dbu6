import { readFile } from "node:fs/promises";
import { userConfigDir } from "../user-data.js";
import type { Account } from "./domain/Account.js";
import { unsafeAsChrono } from "./domain/Chrono.js";
import {
  assembleStatements,
  parseAbacusJson,
  synthesizeRunningBalances,
  validateTransactions,
  verifyClosingBalance,
  type AbacusStatement,
} from "./abacus/index.js";
import { enrichWithGPayHtml } from "./domain/GPayIndex.js";
import { extractAbacusStatement } from "./parsers/freeform-text.js";
import {
  OpeningBalanceUnavailable,
  ClosingBalanceUnavailable,
} from "./import-errors.js";
import {
  lookupLastReconciled,
  newTransactionsSinceReconciliation,
  type RowScopeAuth,
} from "./draft-persistence.js";
import { runDraftImport, type ImportSummary } from "./draft-import.js";
import { assignSourceTransactionKeys } from "../modules/reconciliation/transaction-identity.js";

export {
  AbacusJsonParseError,
  ApiImportError,
  BalanceMismatchError,
  ClosingBalanceUnavailable,
  LLMExtractionError,
  OpeningBalanceUnavailable,
  PdfExtractionFailed,
  ReconciliationMatchError,
  SegmentBalanceMismatchError,
  StatementBoundaryMismatchError,
  StatementDisagreementError,
  StatementPartInvalidError,
  StatementPartUnjoinableError,
} from "./import-errors.js";

export type AccountKind = "bank" | "credit-card";
export type BalanceSource =
  "manual" | "statement" | "checkpoint" | "per-row" | "none";

export interface BalanceOverrides {
  opening: number | null;
  closing: number | null;
}

export interface ResolvedBalance {
  value: number | null;
  source: BalanceSource;
}

export interface ImportOptions {
  baseAccount: Account;
  accountKind: AccountKind;
  balanceOverrides: BalanceOverrides;
  customMappingsFilenames: string[];
  // Path to a staged Google Pay Takeout HTML export. When set, withdrawals
  // that survive the reconciliation filter get their narration prefixed with
  // the GPay recipient before categorization. Applied after transaction keys
  // are assigned, so the takeout never changes transaction identity.
  gpayHtmlPath?: string | null;
}

export interface FreeformImportArgs extends ImportOptions {
  filePaths: string[];
}

export interface ExtractedStatementSource {
  sourceName: string;
  transactionTexts: string[];
  balanceText: string;
}

export interface FreeformImportResult extends ImportSummary {
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
  warnings: string[];
}

// Pick opening balance by precedence: explicit override → LLM-extracted →
// reconciliation checkpoint.
//
// Why LLM over checkpoint: the LLM opening is whatever the statement itself
// printed as its starting balance, so running the walk from it produces
// per-row balances that match the statement's own math. The checkpoint may
// legitimately differ (ledger activity between reconciliations that this
// statement doesn't cover) and is only a reasonable seed when the statement
// didn't print an opening.
//
// Returns source "none" with a null value when none of the three sources
// has a value. Callers that truly need an opening (synthesis path) must
// reject; callers that don't (trust path, when the statement already has
// per-row balances) can proceed.
export function pickOpeningBalance(
  manual: number | null,
  statementOpening: number | null,
  checkpointBalance: number | null,
): ResolvedBalance {
  if (manual !== null) return { value: manual, source: "manual" };
  if (statementOpening !== null)
    return { value: statementOpening, source: "statement" };
  if (checkpointBalance !== null)
    return { value: checkpointBalance, source: "checkpoint" };
  return { value: null, source: "none" };
}

export function pickClosingBalance(
  manual: number | null,
  statementClosing: number | null,
  finalPrintedBalance: number | null,
): ResolvedBalance {
  if (manual !== null) return { value: manual, source: "manual" };
  if (statementClosing !== null)
    return { value: statementClosing, source: "statement" };
  if (finalPrintedBalance !== null)
    return { value: finalPrintedBalance, source: "per-row" };
  return { value: null, source: "none" };
}

function balanceWarnings(
  overrides: BalanceOverrides,
  extracted: { opening: number | null; closing: number | null },
): string[] {
  const warnings: string[] = [];
  if (
    overrides.opening !== null &&
    extracted.opening !== null &&
    Math.abs(overrides.opening - extracted.opening) > 0.005
  ) {
    warnings.push(
      `Manual opening ${overrides.opening} overrides extracted statement opening ${extracted.opening}.`,
    );
  }
  if (
    overrides.closing !== null &&
    extracted.closing !== null &&
    Math.abs(overrides.closing - extracted.closing) > 0.005
  ) {
    warnings.push(
      `Manual closing ${overrides.closing} overrides extracted statement closing ${extracted.closing}.`,
    );
  }
  return warnings;
}

// The freeform pipeline as a spine: text(s) → per-file statement data →
// merged across files → opening picked → running balances filled → shared
// draft-import tail. Multi-file inputs fan out the LLM extraction one call
// per file (so a transaction that wraps across source lines is never split
// by a file boundary) and merge the results by chronological order before
// the single balance-validation + import tail.
export async function runFreeformImport(
  args: FreeformImportArgs,
  db: any,
  auth?: RowScopeAuth,
): Promise<FreeformImportResult> {
  if (args.filePaths.length === 0) {
    throw new Error("runFreeformImport requires at least one file path");
  }

  console.log(
    `[freeform-import] starting import: ${args.filePaths.length} file(s), baseAccount=${args.baseAccount}, accountKind=${args.accountKind}, openingOverride=${args.balanceOverrides.opening}, closingOverride=${args.balanceOverrides.closing}`,
  );
  args.filePaths.forEach((p, i) =>
    console.log(
      `[freeform-import]   file ${i + 1}/${args.filePaths.length}: ${p}`,
    ),
  );

  const sources = await Promise.all(
    args.filePaths.map(async (filePath) => {
      const text = await readFile(filePath, { encoding: "utf-8" });
      return {
        sourceName: filePath,
        transactionTexts: [text],
        balanceText: text,
      } satisfies ExtractedStatementSource;
    }),
  );
  return runFreeformSourceImport(sources, args, db, auth);
}

export async function runFreeformSourceImport(
  sources: ExtractedStatementSource[],
  opts: ImportOptions,
  db: any,
  auth?: RowScopeAuth,
): Promise<FreeformImportResult> {
  if (sources.length === 0) {
    throw new Error(
      "runFreeformSourceImport requires at least one statement source",
    );
  }
  const apiKey = process.env.NUABASE_API_KEY ?? "";
  const parts = await Promise.all(
    sources.map(async (source, index) => {
      const tag = `freeform-text#${index + 1}`;
      return extractAbacusStatement(source.transactionTexts.join("\n"), {
        isCreditCard: opts.accountKind === "credit-card",
        nuabaseApiKey: apiKey,
        logPrefix: tag,
        balanceText: source.balanceText,
      });
    }),
  );
  return runStatementImport(
    parts,
    opts,
    db,
    auth,
    sources.map((source) => source.sourceName),
  );
}

export async function runAbacusJsonImport(
  jsonTexts: string[],
  opts: ImportOptions,
  db: any,
  auth?: RowScopeAuth,
): Promise<FreeformImportResult> {
  if (jsonTexts.length === 0) {
    throw new Error("runAbacusJsonImport requires at least one JSON document");
  }

  console.log(
    `[abacus-json-import] starting import: ${jsonTexts.length} document(s), baseAccount=${opts.baseAccount}, accountKind=${opts.accountKind}, openingOverride=${opts.balanceOverrides.opening}, closingOverride=${opts.balanceOverrides.closing}`,
  );

  const parts = jsonTexts.map((text, i) =>
    parseAbacusJson(text, `abacus-json#${i + 1}`),
  );

  return runStatementImport(
    parts,
    opts,
    db,
    auth,
    jsonTexts.map((_, i) => `abacus-json#${i + 1}`),
  );
}

export async function runStatementImport(
  parts: AbacusStatement[],
  opts: ImportOptions,
  db: any,
  auth?: RowScopeAuth,
  sourceNames: readonly string[] = [],
): Promise<FreeformImportResult> {
  const apiKey = process.env.NUABASE_API_KEY ?? "";
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
  validateTransactions(transactions);
  if (parts.length > 1) {
    console.log(
      `[freeform-import] assembled ${transactions.length} transactions across ${parts.length} part(s): opening=${opening} (first part), closing=${closing} (last part)`,
    );
  } else {
    console.log(
      `[freeform-import] single-part import: ${transactions.length} transactions, opening=${opening}, closing=${closing}`,
    );
  }

  const checkpoint = lookupLastReconciled(db, opts.baseAccount, auth);
  console.log(
    `[freeform-import] reconciliation checkpoint for ${opts.baseAccount}: ${
      checkpoint
        ? `balance=${checkpoint.balance} as of ${checkpoint.date}`
        : "none"
    }`,
  );

  const noPrintedBalances = transactions.every((t) => t.balance === null);
  const allPrintedBalances = transactions.every((t) => t.balance !== null);
  const resolvedOpening = pickOpeningBalance(
    opts.balanceOverrides.opening,
    opening,
    checkpoint?.balance ?? null,
  );
  const finalPrintedBalance =
    transactions[transactions.length - 1]?.balance ?? null;
  const resolvedClosing = pickClosingBalance(
    opts.balanceOverrides.closing,
    closing,
    finalPrintedBalance,
  );
  const warnings = balanceWarnings(opts.balanceOverrides, { opening, closing });

  if (opts.accountKind === "credit-card" && resolvedClosing.value === null) {
    throw new ClosingBalanceUnavailable();
  }

  if (allPrintedBalances) {
    console.log(
      `[freeform-import] every row has a printed balance — trusting as-is`,
    );
  } else if (noPrintedBalances) {
    if (resolvedOpening.value === null) {
      throw new OpeningBalanceUnavailable();
    }
    console.log(
      `[freeform-import] no printed balances — synthesizing from opening ${resolvedOpening.value} (source: ${resolvedOpening.source})`,
    );
  } else {
    const printedCount = transactions.filter((t) => t.balance !== null).length;
    console.log(
      `[freeform-import] hybrid mode: ${printedCount}/${transactions.length} rows have printed balances; using them as checkpoints to fill the rest`,
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
    `[freeform-import] complete statement balance validation passed before reconciliation filtering`,
  );

  const statementEdgeOpening =
    resolvedOpening.source === "manual" ||
    resolvedOpening.source === "statement"
      ? { value: resolvedOpening.value!, source: resolvedOpening.source }
      : null;
  const survivors = newTransactionsSinceReconciliation(
    withBalances,
    checkpoint,
    statementEdgeOpening,
  );
  const filteredCount = withBalances.length - survivors.length;
  if (filteredCount > 0) {
    console.log(
      `[freeform-import] reconciliation filter removed ${filteredCount} already-reconciled row(s); ${survivors.length} survivor(s) remain`,
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
      `[freeform-import] GPay takeout: ${enrichment.indexSize} (date,amount) keys; enriched ${gpayEnrichedCount} of ${survivors.length} narration(s)`,
    );
  }

  if (importable.length > 0) {
    console.log(
      `[freeform-import] handing ${importable.length} validated transactions to draft-import`,
    );
  } else {
    console.log(
      `[freeform-import] entire validated statement already reconciled`,
    );
  }

  const summary = await runDraftImport({
    baseAccount: opts.baseAccount,
    transactions: importable,
    preFiltered: true,
    rawTransactionCount: withBalances.length,
    categorizationConfig: {
      userConfigDir: userConfigDir(),
      customMappingsFilenames: opts.customMappingsFilenames,
      nuabaseApiKey: apiKey,
    },
    logPrefix: "freeform-import",
    db,
    auth,
  });

  console.log(
    `[freeform-import] import complete: opening_balance=${resolvedOpening.value}, closing_balance_from_statement=${closing}, effective_closing=${resolvedClosing.value}`,
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
    warnings,
  };
}

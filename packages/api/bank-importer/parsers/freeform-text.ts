import { Nua } from "nuabase";
import { parse as parseCsvSync } from "csv-parse/sync";
import { z } from "zod";
import {
  abacusRowsJsonSchema,
  abacusSchema,
  analyzeDateOrder,
  applyCreditCardSignFlip,
  normalizeExtractedTransactions,
  type Abacus,
  type AbacusStatement,
} from "../abacus/index.js";
import { LLMExtractionError } from "../import-errors.js";

// Chunk size for CSV extraction: each parcel of this many parsed CSV rows
// becomes one nua.list call, fired in parallel with its siblings. Small
// enough to keep the per-row prompt accurate and to give decent fan-out
// on medium statements (100 rows → 4 concurrent calls).
const CSV_CHUNK_SIZE = 25;

// Two prompts, one per input shape:
//
//   FREEFORM — the text is a statement dump (raw PDF table, plaintext
//   paragraph layout) where transaction boundaries are implicit. The LLM
//   has to detect where one record ends and the next begins, so we send
//   the full blob to nua.get and let it emit the whole transaction list.
//
//   CSV — the text parses cleanly as a CSV file. Each parsed record (the
//   CSV library has already resolved quoted-newline boundaries) is handed
//   to nua.list as one row, keyed by a continuous csvRowIndex. This gets
//   us nuabase's content-addressed row cache for free: reruns of the same
//   statement skip the LLM entirely, and recurring rows across statements
//   from the same bank cache-hit individually.
const FREEFORM_TRANSACTIONS_PROMPT = `You are a financial data parser. The input is the complete text of one bank or credit-card statement for one period. Extract every transaction as a structured record.

Transaction records in a statement can span a variable number of source lines. The merchant/narration column often wraps across multiple lines, and some statements insert reference numbers, FX details, or metadata on separate lines that belong to the preceding transaction. You must detect where one record ends and the next begins — do not assume one line equals one record.

Look for the statement's own column markers to find boundaries:
- A new transaction typically begins on a line whose leftmost field is a date.
- The running balance (when printed) sits in the rightmost column on the record's anchor line.
- The amount (withdrawal or deposit) sits in a column near the balance.
- Lines without a date in the date column, and without amount/balance values, are continuations of the previous record's narration.
- Horizontal rules, section headers, or changes in column layout may separate transaction blocks from summary/footer blocks.

ABACUS FORMAT (per-transaction fields):
- date: YYYY-MM-DD
- narration: the description/merchant verbatim from the statement. If the description wraps across multiple source lines, join those lines with a single space. Preserve case, punctuation, reference numbers, and any trailing metadata that belongs to this transaction.
- withdrawal: money out (positive number, 0 if not applicable)
- deposit: money in (positive number, 0 if not applicable)
- balance: running balance printed on the record, or null if the record does not print one
- source_reference: stable transaction/reference number printed for the record, or null when absent

RULES:
1. Emit one record per transaction, no matter how many source lines that transaction occupies. Do not emit a record for headers, column labels, footers, account-summary blocks, opening/closing balance lines, page numbers, or decorative separators — skip those entirely.
2. If a record contains both USD and INR amounts, use the INR value. Our currency is INR.
3. Copy the narration verbatim from the statement; do not editorialize, translate, or reformat amounts or merchant names.
4. Convert the date to YYYY-MM-DD regardless of source format.
5. Handle formatting variations: currency symbols, commas in numbers, parentheses for negatives.
6. Balance capture is binary: if the record prints a running balance, record it exactly as printed; otherwise null. Do not guess and do not re-sign.
7. Classify direction: money leaving the account is withdrawal; money arriving is deposit. Never populate both.
8. Preserve the order in which transactions appear in the statement.

OUTPUT CONTRACT:
Return one Abacus JSON object with exactly this top-level shape:
{"kind":"abacus","rows":[<transaction records>]}
The discriminator must be the literal string "abacus". The transaction array key must be "rows", not "transactions". Do not return a bare array.`;

const CSV_ROW_PROMPT = `You are a financial data parser. Each input is exactly ONE row of a bank or credit-card transaction CSV, delivered as a JSON object whose keys are the original CSV header columns (plus a \`csvRowIndex\` field identifying the row's position — ignore it for parsing purposes; it is only a pointer). Your job is to map this single row to the Abacus transaction schema, or return null if the row is not a transaction.

Some PDF table extractors emit blank or duplicate column headings. In that case the importer assigns a unique synthetic key while preserving column order: \`column_N\` means the original heading at 1-based position N was blank, and \`<heading>__column_N\` means that heading was a duplicate. Infer these columns from their values and positions. In particular, a synthetic leftmost column containing date-like values is usually the transaction date, and a synthetic rightmost column containing money-like values is usually the INR transaction amount.

ABACUS FORMAT (per-transaction fields):
- date: YYYY-MM-DD
- narration: the description/merchant cell verbatim. If the cell contains embedded newlines, join them with a single space.
- withdrawal: money out (positive number, 0 if not applicable)
- deposit: money in (positive number, 0 if not applicable)
- balance: running-balance cell value, or null if this row has no balance column
- source_reference: transaction/reference cell value, or null when absent

COLUMN MAPPING (column names vary by bank — match on meaning, not literal name):
- Date column: "Date", "Txn Date", "Transaction Date", "Value Date", "Posting Date". If multiple date columns exist, prefer the transaction/posting date over the value date.
- Narration column: "Narration", "Description", "Particulars", "Merchant", "Transaction Details".
- Amount column(s): either a single signed column ("Amount" — positive=deposit, negative=withdrawal) or two columns ("Debit"/"Credit", "Withdrawal"/"Deposit", "Out"/"In"). Map to withdrawal/deposit accordingly. Never populate both on the same row.
- Balance column: "Balance", "Running Balance", "Closing Balance", "Available Balance".

RULES:
1. Return null if this row is not a transaction — e.g. an inline "Opening Balance", "Closing Balance", "Total", or other summary line the CSV author left in. Otherwise emit the transaction record.
2. If the row contains both USD and INR amounts, use the INR value. Our currency is INR.
3. Copy the narration column value verbatim.
4. Convert the date to YYYY-MM-DD regardless of source format.
5. Handle formatting variations: currency symbols, commas in numbers, parentheses for negatives.
6. Balance capture: if a balance column is present on this row, record its value exactly as printed; otherwise null. Do not guess and do not re-sign.
7. Classify direction: money leaving the account is withdrawal; money arriving is deposit. Never populate both.`;

const BALANCES_PROMPT = `Analyze the bank or credit-card statement text and extract the opening and closing balances in a single pass. "Opening" means the balance at the start of the statement period; "closing" means the balance at the end. Labels vary widely across banks, card issuers, and countries — match on meaning, not exact wording.

OPENING BALANCE — common labels across bank and credit-card statements:
- Bank: "opening balance", "balance brought forward", "balance b/f", "b/fwd", "brought forward", "starting balance", "beginning balance", "balance forward", "previous balance", "prior period balance", "balance as on <start-date>".
- Credit card: "previous balance", "previous statement balance", "balance from previous statement", "prior balance", "last statement balance", "opening balance".

CLOSING BALANCE — common labels:
- Bank: "closing balance", "ending balance", "final balance", "balance carried forward", "balance c/f", "c/fwd", "carried forward", "balance as on <end-date>", "statement balance".
- Credit card: "new balance", "total amount due", "total payment due", "total dues", "total outstanding", "amount due", "balance due", "current balance", "statement balance", "closing balance", "new balance due".

"Minimum Amount Due" / "Minimum Payment Due" is NOT the closing balance — it is the minimum the cardholder must pay this cycle, not the total owed. Ignore it when picking the closing balance.

RULES:
1. Only extract a balance that is explicitly labeled (or appears in a clearly-labeled summary box like "Account Summary" / "Statement Summary" / "Payment Summary"). Do not infer from per-row running balances or arithmetic on transactions.
2. For credit cards, the closing balance is the total outstanding owed at statement end — usually labeled "Total Amount Due", "New Balance", "Statement Balance", or "Closing Balance". Do not confuse it with "Minimum Amount Due" or with the credit limit.
3. Extract each number with its sign (positive or negative) as printed. Credit-card balances are typically printed as positive amounts owed; preserve that sign as-is.
4. If a given balance is not found, return null for that field. Opening and closing are independent — one may be present without the other.
5. Be conservative — only return values you are confident about.`;

const transactionsSchema = abacusRowsJsonSchema;

const balancesSchema = z.object({
  opening: z.number().nullable(),
  closing: z.number().nullable(),
});

const EXTRACTION_MODEL = {
  provider: "openrouter",
  model: "z-ai/glm-5.2",
} as const;
const EXTRACTION_MODEL_LABEL = `${EXTRACTION_MODEL.provider}:${EXTRACTION_MODEL.model}`;

// Per-row schema for the CSV chunked path. Nullable at the top level so
// the LLM can mark summary/non-transaction rows for skipping — nua.list
// is 1:1 input→output, so "skip" is encoded as an explicit null instead
// of a missing record.
const csvRowTransactionSchema = abacusSchema.nullable();

// Cheap structural check: if a real CSV parser accepts the text as
// well-formed tabular data (header + consistent column counts, ≥3
// columns), we don't need the LLM to rediscover row boundaries. Parse to
// arrays first, rather than asking csv-parse to build objects: object mode
// silently overwrites fields when PDF extraction produces blank or duplicate
// headings. We assign deterministic unique headings and then create objects
// ourselves, preserving every physical column. `relax_column_count: false`
// rejects anything where rows disagree on column count, which knocks out
// plain-text statements whose layout only *looks* comma-separated.
//
// We keep the parsed shape (row count, column names) on the positive
// branch and the parser's error message on the negative branch so the
// decision is loggable and auditable — when CSV detection misfires in
// production, the logs tell you exactly why.
export type CsvDetection =
  | {
      kind: "csv";
      rows: number;
      columns: string[];
      records: Record<string, string>[];
    }
  | { kind: "not-csv"; reason: string };

function makeUniqueCsvColumns(rawColumns: string[]): string[] {
  const originalNames = new Set(rawColumns.filter((name) => name !== ""));
  const seenOriginals = new Set<string>();
  const used = new Set<string>();

  const allocateSynthetic = (base: string): string => {
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate) || originalNames.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  };

  return rawColumns.map((name, index) => {
    if (name !== "" && !seenOriginals.has(name)) {
      seenOriginals.add(name);
      used.add(name);
      return name;
    }

    const position = index + 1;
    return allocateSynthetic(
      name === "" ? `column_${position}` : `${name}__column_${position}`,
    );
  });
}

export function detectCsv(text: string): CsvDetection {
  let parsedRows: string[][];
  try {
    parsedRows = parseCsvSync(text, {
      columns: false,
      skip_empty_lines: true,
      relax_column_count: false,
      trim: true,
    }) as string[][];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "not-csv", reason: `parse error: ${message}` };
  }
  if (parsedRows.length < 2) {
    return { kind: "not-csv", reason: "header only, no data rows" };
  }
  const rawColumns = parsedRows[0];
  if (rawColumns.length < 3) {
    return {
      kind: "not-csv",
      reason: `only ${rawColumns.length} column(s), need ≥3`,
    };
  }
  const columns = makeUniqueCsvColumns(rawColumns);
  const records = parsedRows
    .slice(1)
    .map((row) =>
      Object.fromEntries(columns.map((column, index) => [column, row[index]])),
    );
  return { kind: "csv", rows: records.length, columns, records };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// Pure helpers for the CSV path. Kept outside the I/O shells so they
// can be unit-tested on plain data and so the extractor functions stay
// thin (call LLM → hand results to a pure assembler → return).
export type IndexedCsvRow = {
  csvRowIndex: number;
  [column: string]: string | number;
};

export function indexCsvRecords(
  records: Record<string, string>[],
): IndexedCsvRow[] {
  return records.map((r, i) => ({ csvRowIndex: i, ...r }));
}

export type CsvRowExtraction = {
  csvRowIndex: number;
  transaction: z.infer<typeof csvRowTransactionSchema>;
};

// Flatten per-chunk LLM results back into a single `Abacus[]`. Re-sorts
// by csvRowIndex because parallel chunks may settle out of order, and
// drops nulls (the LLM's signal for non-transaction rows like inline
// "Opening Balance" summaries).
export function assembleCsvResults(chunkResults: CsvRowExtraction[][]): {
  transactions: Abacus[];
  skipped: number;
} {
  const flat = chunkResults
    .flat()
    .sort((a, b) => a.csvRowIndex - b.csvRowIndex);
  const kept = flat.flatMap((r) =>
    r.transaction === null ? [] : [r.transaction],
  );
  return { transactions: kept, skipped: flat.length - kept.length };
}

async function extractTransactions(
  text: string,
  nuabaseApiKey: string,
  logPrefix: string,
): Promise<Abacus[]> {
  const detection = detectCsv(text);
  if (detection.kind === "csv") {
    console.log(
      `[${logPrefix}] csv detection: csv (${detection.rows} data row(s), ${detection.columns.length} column(s): ${detection.columns.join(", ")})`,
    );
    return extractTransactionsFromCsv(
      detection.records,
      nuabaseApiKey,
      logPrefix,
    );
  }
  console.log(`[${logPrefix}] csv detection: not-csv (${detection.reason})`);
  return extractTransactionsFromFreeform(text, nuabaseApiKey, logPrefix);
}

async function extractTransactionsFromFreeform(
  text: string,
  nuabaseApiKey: string,
  logPrefix: string,
): Promise<Abacus[]> {
  console.log(
    `[${logPrefix}] transactions: calling LLM (mode=freeform, model=${EXTRACTION_MODEL_LABEL}, input=${text.length}B)`,
  );
  const nua = Nua.gateway({ apiKey: nuabaseApiKey });
  const result = await nua.get(FREEFORM_TRANSACTIONS_PROMPT, {
    input: text,
    output: { name: "statement", schema: transactionsSchema },
    model: EXTRACTION_MODEL,
  });
  if (!result.success) {
    console.log(
      `[${logPrefix}] transactions: LLM call FAILED (${result.latencyMs}ms): ${String(result.error)}`,
    );
    throw new LLMExtractionError("transactions", String(result.error));
  }
  const data = result.data as z.infer<typeof transactionsSchema>;
  console.log(
    `[${logPrefix}] transactions: ${data.rows.length} extracted in ${result.latencyMs}ms (model=${result.model})`,
  );
  return data.rows;
}

// Chunked per-row path. Pure data prep (`indexCsvRecords`, `chunk`,
// `assembleCsvResults`) lives alongside so the I/O here is just the
// parallel nua.list calls.
async function extractTransactionsFromCsv(
  records: Record<string, string>[],
  nuabaseApiKey: string,
  logPrefix: string,
): Promise<Abacus[]> {
  const indexed = indexCsvRecords(records);
  const parcels = chunk(indexed, CSV_CHUNK_SIZE);
  console.log(
    `[${logPrefix}] csv chunks: ${parcels.length} × up to ${CSV_CHUNK_SIZE} rows (${indexed.length} total, primaryKey=csvRowIndex, model=${EXTRACTION_MODEL_LABEL})`,
  );

  const nua = Nua.gateway({ apiKey: nuabaseApiKey });
  const start = Date.now();

  const chunkResults = await Promise.all(
    parcels.map(async (parcel, i) => {
      const result = await nua.list(CSV_ROW_PROMPT, {
        input: parcel,
        primaryKey: "csvRowIndex",
        output: { name: "transaction", schema: csvRowTransactionSchema },
        model: EXTRACTION_MODEL,
      });
      if (!result.success) {
        console.log(
          `[${logPrefix}] transactions chunk ${i + 1}/${parcels.length}: LLM call FAILED (${result.latencyMs}ms): ${String(result.error)}`,
        );
        throw new LLMExtractionError(
          "transactions",
          `chunk ${i + 1}/${parcels.length}: ${String(result.error)}`,
        );
      }
      return result.data as CsvRowExtraction[];
    }),
  );

  const { transactions, skipped } = assembleCsvResults(chunkResults);
  console.log(
    `[${logPrefix}] transactions: ${transactions.length} extracted (${skipped} null row(s) skipped) across ${parcels.length} chunk(s) in ${Date.now() - start}ms`,
  );
  return transactions;
}

async function extractBalances(
  text: string,
  nuabaseApiKey: string,
  logPrefix: string,
): Promise<{ opening: number | null; closing: number | null }> {
  const nua = Nua.gateway({ apiKey: nuabaseApiKey });
  const result = await nua.get(BALANCES_PROMPT, {
    input: text,
    output: { name: "balances", schema: balancesSchema },
    model: EXTRACTION_MODEL,
  });
  if (!result.success) {
    console.log(
      `[${logPrefix}] balances: LLM call FAILED (${result.latencyMs}ms): ${String(result.error)}`,
    );
    throw new LLMExtractionError("balances", String(result.error));
  }
  console.log(
    `[${logPrefix}] balances: opening=${result.data.opening}, closing=${result.data.closing} (${result.latencyMs}ms, model=${result.model})`,
  );
  return { opening: result.data.opening, closing: result.data.closing };
}

// Transactions and balances are independent HTTP calls — run them in
// parallel. Opening and closing share a single call: they're both small,
// label-driven lookups over the same text, so merging them halves the
// input-token cost and lets the model disambiguate both labels together.
//
// This runs per file. Callers importing multiple files invoke this once
// per file and merge the results (see runFreeformImport) rather than
// concatenating texts, so a transaction that wraps across lines is never
// split by a file boundary.
export async function extractAbacusStatement(
  text: string,
  config: {
    isCreditCard: boolean;
    nuabaseApiKey: string;
    logPrefix?: string;
    balanceText?: string;
  },
): Promise<AbacusStatement> {
  const logPrefix = config.logPrefix ?? "freeform-text";
  const sourceLines = text.split(/\r?\n/);
  console.log(
    `[${logPrefix}] starting extraction: ${text.length} bytes, ${sourceLines.length} source line(s)${
      config.isCreditCard ? " (credit card)" : ""
    }`,
  );
  const lineNumberWidth = String(sourceLines.length).length;
  console.log(
    `[${logPrefix}] source text begin\n${sourceLines
      .map(
        (line, index) =>
          `[${logPrefix}] ${String(index + 1).padStart(lineNumberWidth)} | ${line}`,
      )
      .join("\n")}\n[${logPrefix}] source text end`,
  );

  const [transactions, balances] = await Promise.all([
    extractTransactions(text, config.nuabaseApiKey, logPrefix),
    extractBalances(
      config.balanceText ?? text,
      config.nuabaseApiKey,
      logPrefix,
    ),
  ]);

  const dateOrder = analyzeDateOrder(transactions);
  console.log(
    `[${logPrefix}] parsed transaction output (schema-validated, source order):\n${JSON.stringify(
      transactions.map((transaction, index) => ({
        sourceRow: index + 1,
        transitionFromPrevious:
          index === 0 ? "start" : dateOrder.transitions[index - 1].direction,
        ...transaction,
      })),
      null,
      2,
    )}`,
  );
  console.log(
    `[${logPrefix}] date-order analysis: ${dateOrder.ascendingPairs} ascending, ${dateOrder.descendingPairs} descending, ${dateOrder.sameDatePairs} same-date transition(s)`,
  );
  const mixedOrder =
    dateOrder.ascendingPairs > 0 && dateOrder.descendingPairs > 0;
  if (mixedOrder) {
    const canTreatAsUnordered = transactions.every(
      (transaction) => transaction.balance === null,
    );
    console.warn(
      `[${logPrefix}] date-order conflict (${dateOrder.minorityDirection === null ? "all date-changing transitions shown" : `${dateOrder.minorityDirection} is the minority direction`}):\n${JSON.stringify(dateOrder.conflictingTransitions, null, 2)}${canTreatAsUnordered ? "\nNo transaction has a printed running balance; treating the source as explicitly unordered before date-sorting." : ""}`,
    );
  }
  console.log(
    `[${logPrefix}] normalizing ${transactions.length} parsed transaction(s) to chronological order`,
  );

  const raw: AbacusStatement = {
    transactions: normalizeExtractedTransactions(transactions),
    opening: balances.opening,
    closing: balances.closing,
    account: null,
    institution: null,
  };
  const signed = applyCreditCardSignFlip(raw, config.isCreditCard);

  if (config.isCreditCard) {
    console.log(
      `[${logPrefix}] credit-card sign-flip applied to opening, closing, and per-row balances`,
    );
  }
  console.log(
    `[${logPrefix}] extraction done: ${signed.transactions.length} transaction(s), opening=${signed.opening}, closing=${signed.closing}`,
  );

  return signed;
}

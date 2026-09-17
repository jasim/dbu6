import { z } from "zod";
import type { CategorizationEngine, CategorizationReport } from "dbu6-shared";
import type { CategorizationLlm, ListRow } from "../../llm-engine.js";
import type { Abacus } from "../abacus/index.js";
import type { Account } from "../domain/Account.js";
import { parseAccount } from "../domain/Account.js";
import { isWithdrawal } from "../domain/Money.js";

export interface LLMCategorizationConfig {
  promptTemplate: string;
  hledgerAccounts: string;
  customMappings: string;
  llm: CategorizationLlm;
}

export interface LLMRequest {
  prompt: string;
  rows: Array<{ id: string; text: string }>;
  reverseMap: Record<string, string[]>;
}

export interface LLMResponseRow {
  id: string;
  account: string;
}

/**
 * Build the LLM prompt by filling placeholders in the template.
 */
export function buildPrompt(config: LLMCategorizationConfig): string {
  return config.promptTemplate
    .replace("{hledger_accounts}", config.hledgerAccounts)
    .replace("{custom_mapping}", config.customMappings);
}

/**
 * Prepare deduplicated input rows for nua.list().
 *
 * Each unmapped transaction gets prefixed with "Expense: " or "Deposit: ".
 * Narrations are sent verbatim so the LLM can use every part of the transaction.
 * Duplicate texts produce one row; the reverse map tracks all original narrations.
 */
export function buildLLMInput(
  transactions: Abacus[],
  unmappedIndices: number[],
): {
  rows: Array<{ id: string; text: string }>;
  reverseMap: Record<string, string[]>;
} {
  const rows: Array<{ id: string; text: string }> = [];
  const reverseMap: Record<string, string[]> = {};
  const seenTexts = new Map<string, string>(); // text -> rowId

  for (const idx of unmappedIndices) {
    const t = transactions[idx];
    const prefix = isWithdrawal(t) ? "Expense" : "Deposit";
    const text = `${prefix}: ${t.narration}`;

    const existingId = seenTexts.get(text);
    if (existingId) {
      reverseMap[existingId].push(t.narration);
    } else {
      const id = `txn-${rows.length}`;
      seenTexts.set(text, id);
      rows.push({ id, text });
      reverseMap[id] = [t.narration];
    }
  }

  return { rows, reverseMap };
}

/**
 * Pure: assemble everything that would be sent to Nua.list().
 * The I/O shell calls this, then calls Nua, then calls parseLLMResponse.
 */
export function buildLLMRequest(
  transactions: Abacus[],
  unmappedIndices: number[],
  config: LLMCategorizationConfig,
): LLMRequest {
  const prompt = buildPrompt(config);
  const { rows, reverseMap } = buildLLMInput(transactions, unmappedIndices);
  return { prompt, rows, reverseMap };
}

/**
 * Pure: turn the rows returned by Nua.list() into a narration→Account map.
 * Skips rows with empty/missing accounts.
 */
export function parseLLMResponse(
  rows: LLMResponseRow[],
  reverseMap: Record<string, string[]>,
): Record<string, Account> {
  const mappings: Record<string, Account> = {};
  for (const row of rows) {
    const account = row.account;
    if (!account || !account.trim()) continue;

    const originalNarrations = reverseMap[row.id];
    if (originalNarrations) {
      for (const narration of originalNarrations) {
        mappings[narration] = parseAccount(account);
      }
    }
  }
  return mappings;
}

/** The report when no description needed the LLM. */
export function nothingSentReport(
  engine: CategorizationEngine | null,
): CategorizationReport {
  return { engine, sent_count: 0, failed_count: 0, error: null };
}

/** The narration→Account answers, and how the LLM fared. */
export interface LLMCategorization {
  mappings: Record<string, Account>;
  report: CategorizationReport;
}

/**
 * Pure: the rows in calls of at most `maxRowsPerCall`, in order; one call
 * when there is no limit.
 */
export function splitIntoCalls<T>(
  rows: readonly T[],
  maxRowsPerCall: number | null,
): T[][] {
  if (maxRowsPerCall === null || rows.length <= maxRowsPerCall) {
    return [[...rows]];
  }
  const calls: T[][] = [];
  for (let start = 0; start < rows.length; start += maxRowsPerCall) {
    calls.push(rows.slice(start, start + maxRowsPerCall));
  }
  return calls;
}

const MAX_REPORTED_ERROR_LENGTH = 300;

/**
 * Pure: a failure message short enough to show on a screen. An HTML error
 * page (a gateway's 500) is reduced to its title, whitespace is collapsed,
 * and anything past 300 characters is cut. The full message stays in the log.
 */
export function reportedError(message: string): string {
  const title = /<title>([^<]*)<\/title>/i.exec(message)?.[1];
  const text = (title ?? message).replace(/\s+/g, " ").trim();
  return text.length > MAX_REPORTED_ERROR_LENGTH
    ? `${text.slice(0, MAX_REPORTED_ERROR_LENGTH - 1)}…`
    : text;
}

type ReadyCaller = Extract<CategorizationLlm["caller"], { ready: true }>;

type CallOutcome =
  | { ok: true; rows: LLMResponseRow[] }
  | { ok: false; rowCount: number; error: string };

async function callList(
  engine: CategorizationLlm["engine"],
  caller: ReadyCaller,
  prompt: string,
  rows: ListRow[],
  label: string,
): Promise<CallOutcome> {
  console.log(`\n── [${engine}] LLM Categorization Request${label} ──`);
  console.log("Input rows:\n", JSON.stringify(rows, null, 2));

  let result;
  try {
    result = await caller.nua.list(prompt, {
      input: rows,
      primaryKey: "id",
      output: { name: "account", schema: z.string() },
      model: caller.model,
    });
  } catch (error) {
    result = {
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!result.success) {
    console.error(
      `[${engine}] LLM categorization failed${label}:`,
      result.error,
    );
    // Typed as a string, but a gateway may pass an error object through.
    return { ok: false, rowCount: rows.length, error: String(result.error) };
  }

  console.log(`\n── [${engine}] LLM Categorization Response${label} ──`);
  console.log(JSON.stringify(result.data, null, 2));
  return { ok: true, rows: result.data as LLMResponseRow[] };
}

/**
 * I/O shell: ask the LLM for the accounts of unmapped transactions, in calls
 * of at most `llm.maxRowsPerCall` descriptions run together. Returns a map
 * from original narration to Account with the answers of the calls that
 * succeeded, and a report counting the descriptions left unanswered because
 * a call failed or couldn't run. Failures are reported, never thrown.
 */
export async function categorizeViaLLM(
  transactions: Abacus[],
  unmappedIndices: number[],
  config: LLMCategorizationConfig,
): Promise<LLMCategorization> {
  const { engine, caller, maxRowsPerCall } = config.llm;
  const { prompt, rows, reverseMap } = buildLLMRequest(
    transactions,
    unmappedIndices,
    config,
  );
  const report: CategorizationReport = {
    ...nothingSentReport(engine),
    sent_count: rows.length,
  };
  if (rows.length === 0) return { mappings: {}, report };

  if (!caller.ready) {
    console.error(
      `[${engine ?? "no coding agent"}] LLM categorization can't run: ${caller.reason}`,
    );
    return {
      mappings: {},
      report: { ...report, failed_count: rows.length, error: caller.reason },
    };
  }

  console.log(`\n── [${engine}] LLM Categorization Prompt ──`);
  console.log(prompt);
  const calls = splitIntoCalls(rows, maxRowsPerCall);
  const outcomes = await Promise.all(
    calls.map((callRows, index) =>
      callList(
        engine,
        caller,
        prompt,
        callRows,
        calls.length === 1 ? "" : ` (call ${index + 1} of ${calls.length})`,
      ),
    ),
  );

  const answered: LLMResponseRow[] = [];
  for (const outcome of outcomes) {
    if (outcome.ok) {
      answered.push(...outcome.rows);
    } else {
      report.failed_count += outcome.rowCount;
      report.error ??= reportedError(outcome.error);
    }
  }
  return { mappings: parseLLMResponse(answered, reverseMap), report };
}

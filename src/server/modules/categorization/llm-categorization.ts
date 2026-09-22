import { z } from "zod";
import type { CategorizationReport, CodingAgent } from "../../../shared/index.js";
import type { Abacus } from "../statement/index.js";
import { type Account, parseAccount, isWithdrawal } from "../values/index.js";

/*
 * What categorization needs of an LLM, and who can answer it: one call that
 * takes a prompt and a batch of descriptions and answers each by id. The
 * coding agent and the deprecated gateway both fill it, in
 * coding-agent/categorization-llm.ts.
 */

export type ListRow = { id: string; text: string };

export interface ListRequest {
  prompt: string;
  rows: readonly ListRow[];
  /** The field to answer each row in. */
  output: { name: string; schema: z.ZodType<string> };
}

// A failed call's error is fit to show on a screen as it is: the client keeps
// the full message for its log.
export type ListAnswer =
  { ok: true; rows: unknown[] } | { ok: false; error: string };

export interface ListClient {
  list(request: ListRequest): Promise<ListAnswer>;
}

export interface CategorizationLlm {
  /**
   * The coding agent categorization runs on, for the report. Null when it runs
   * on no agent: the deprecated gateway, or none installed.
   */
  agent: CodingAgent | null;
  /** What to call the engine in the log. */
  name: string;
  /** Who answers and how much one call carries, or why no call can run. */
  caller:
    | {
        ready: true;
        client: ListClient;
        /** The most descriptions one call carries; null sends them all. */
        maxRowsPerCall: number | null;
      }
    | { ready: false; reason: string };
}

export interface LLMCategorizationConfig {
  promptTemplate: string;
  // The account names the LLM may answer with, one per line.
  accounts: string;
  customMappings: string;
  llm: CategorizationLlm;
}

export interface LLMRequest {
  prompt: string;
  rows: ListRow[];
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
    .replace("{accounts}", config.accounts)
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
  rows: ListRow[];
  reverseMap: Record<string, string[]>;
} {
  const rows: ListRow[] = [];
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

/**
 * The report when no description needed the LLM. Only categorize.ts builds one:
 * everything outside categorization is given the report of the run it asked
 * for.
 */
export function nothingSentReport(
  llm: CategorizationLlm,
): CategorizationReport {
  return { agent: llm.agent, sent_count: 0, failed_count: 0, error: null };
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

const ACCOUNT_OUTPUT = { name: "account", schema: z.string() };

type ReadyCaller = Extract<CategorizationLlm["caller"], { ready: true }>;

type CallOutcome =
  | { ok: true; rows: LLMResponseRow[] }
  | { ok: false; rowCount: number; error: string };

async function callList(
  llm: CategorizationLlm,
  caller: ReadyCaller,
  prompt: string,
  rows: ListRow[],
  label: string,
): Promise<CallOutcome> {
  console.log(`\n── [${llm.name}] LLM Categorization Request${label} ──`);
  console.log("Input rows:\n", JSON.stringify(rows, null, 2));

  const answer = await caller.client.list({
    prompt,
    rows,
    output: ACCOUNT_OUTPUT,
  });
  if (!answer.ok) {
    console.error(
      `[${llm.name}] LLM categorization failed${label}:`,
      answer.error,
    );
    return { ok: false, rowCount: rows.length, error: answer.error };
  }

  console.log(`\n── [${llm.name}] LLM Categorization Response${label} ──`);
  console.log(JSON.stringify(answer.rows, null, 2));
  return { ok: true, rows: answer.rows as LLMResponseRow[] };
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
  const { llm } = config;
  const { prompt, rows, reverseMap } = buildLLMRequest(
    transactions,
    unmappedIndices,
    config,
  );
  const report: CategorizationReport = {
    ...nothingSentReport(llm),
    sent_count: rows.length,
  };
  if (rows.length === 0) return { mappings: {}, report };

  if (!llm.caller.ready) {
    console.error(
      `[${llm.name}] LLM categorization can't run: ${llm.caller.reason}`,
    );
    return {
      mappings: {},
      report: {
        ...report,
        failed_count: rows.length,
        error: llm.caller.reason,
      },
    };
  }

  console.log(`\n── [${llm.name}] LLM Categorization Prompt ──`);
  console.log(prompt);
  const calls = splitIntoCalls(rows, llm.caller.maxRowsPerCall);
  const caller = llm.caller;
  const outcomes = await Promise.all(
    calls.map((callRows, index) =>
      callList(
        llm,
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
      report.error ??= outcome.error;
    }
  }
  return { mappings: parseLLMResponse(answered, reverseMap), report };
}

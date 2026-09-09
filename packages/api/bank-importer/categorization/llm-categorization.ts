import { Nua } from "nuabase";
import { z } from "zod";
import type { Abacus } from "../domain/Abacus.js";
import type { Account } from "../domain/Account.js";
import { parseAccount } from "../domain/Account.js";
import { isWithdrawal } from "../domain/Money.js";

export interface LLMCategorizationConfig {
  promptTemplate: string;
  hledgerAccounts: string;
  customMappings: string;
  nuabaseApiKey: string;
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

type NuaGateway = ReturnType<typeof Nua.gateway>;

const CATEGORIZATION_MODEL = {
  provider: "openrouter",
  model: "z-ai/glm-5.2",
} as const;

async function callCategorizationLLM(
  nua: NuaGateway,
  request: LLMRequest,
): Promise<Record<string, Account>> {
  const { prompt, rows, reverseMap } = request;
  if (rows.length === 0) return {};

  console.log(`\n── LLM Categorization Request  ──`);
  console.log("Prompt:\n", prompt);
  console.log("Input rows:\n", JSON.stringify(rows, null, 2));

  const result = await nua.list(prompt, {
    input: rows,
    primaryKey: "id",
    output: { name: "account", schema: z.string() },
    model: CATEGORIZATION_MODEL,
  });

  if (!result.success) {
    console.error(`LLM categorization failed :`, result.error);
    return {};
  }

  console.log(`\n── LLM Categorization Response  ──`);
  console.log(JSON.stringify(result.data, null, 2));

  return parseLLMResponse(result.data as LLMResponseRow[], reverseMap);
}

/**
 * I/O shell: call nua.list() to categorize unmapped transactions.
 * Returns a map from original narration to Account.
 * Returns {} on failure (graceful degradation).
 */
export async function categorizeViaLLM(
  transactions: Abacus[],
  unmappedIndices: number[],
  config: LLMCategorizationConfig,
): Promise<Record<string, Account>> {
  const request = buildLLMRequest(transactions, unmappedIndices, config);

  if (request.rows.length === 0) return {};

  const nua = Nua.gateway({ apiKey: config.nuabaseApiKey });
  return callCategorizationLLM(nua, request);
}

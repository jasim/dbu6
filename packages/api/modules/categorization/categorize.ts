import type { z } from "zod";
import type { CategorizationReport, sameAccountSkipSchema } from "dbu6-shared";
import type { Abacus } from "../statement/index.js";
import { type Account, UNCATEGORIZED } from "../values/index.js";
import {
  resolveAccountIdForCategorized,
  type AccountsByName,
  type CategorizedTransaction,
} from "./CategorizedTransaction.js";
import {
  categorizeViaLLM,
  nothingSentReport,
  type CategorizationLlm,
} from "./llm-categorization.js";
import { PROMPT_TEMPLATE } from "./prompt-template.js";

/*
 * Categorization below its top: what `loadCategorizer` read, applied to
 * statement rows. Nothing here reads a file. Imports and reclassification both
 * categorize through `categorize`.
 */

// A part of the user's config, or why it can't be used. A part is needed only
// once a row reaches it, so a missing or broken file refuses only then.
export type ConfigPart<T> =
  { ok: true; value: T } | { ok: false; error: unknown };

export interface Categorizer {
  // The mapping rules (transaction_mappings.mjs), needed as soon as there is a
  // row.
  classify: ConfigPart<(transaction: Abacus) => Account | null>;
  // The preset's instructions (custom_mappings_*.prompt), needed once a row is
  // left for the LLM.
  customMappings: ConfigPart<string>;
  llm: CategorizationLlm;
}

export interface CategorizationRow {
  transaction: Abacus;
  // The ledger account whose statement holds the row, for the same-account
  // rule; null when the ledger has no such account.
  baseAccountId: number | null;
}

export interface CategorizedRow extends CategorizedTransaction {
  // The ledger account `account` names, or null: uncategorized, an answer
  // that names no ledger account, or the row's own base account.
  accountId: number | null;
}

export type SameAccountSkip = z.infer<typeof sameAccountSkipSchema>;

export interface Categorization {
  // One per row, in order.
  rows: CategorizedRow[];
  sameAccountSkips: SameAccountSkip[];
  report: CategorizationReport;
}

/**
 * Each row's account: the mapping rules first, the LLM for the rest, choosing
 * from the ledger's accounts, then the ledger account the answer names, left
 * out when it is the row's own base account. With the report of how the LLM
 * fared.
 */
export async function categorize(
  categorizer: Categorizer,
  rows: readonly CategorizationRow[],
  accountsByName: AccountsByName,
): Promise<Categorization> {
  const { accounts, report } = await answerAccounts(
    categorizer,
    rows.map((row) => row.transaction),
    accountsByName,
  );
  const sameAccountSkips: SameAccountSkip[] = [];
  const categorized = rows.map(({ transaction, baseAccountId }, index) => {
    const account = accounts[index];
    const { accountId, sameAccountSkip } = resolveAccountIdForCategorized(
      account,
      accountsByName,
      baseAccountId,
    );
    if (sameAccountSkip) {
      sameAccountSkips.push({
        date: transaction.date,
        narration: transaction.narration,
        account,
      });
    }
    return { transaction, account, accountId };
  });
  return { rows: categorized, sameAccountSkips, report };
}

function need<T>(part: ConfigPart<T>): T {
  if (!part.ok) throw part.error;
  return part.value;
}

// The accounts the LLM may answer with, one name per line: the ledger's own,
// but for Equity (opening balances and the like), which no statement row is
// categorized to.
function offeredAccounts(accountsByName: AccountsByName): string {
  return [...accountsByName]
    .filter(([, account]) => account.account_type !== "Equity")
    .map(([name]) => name)
    .sort()
    .join("\n");
}

/**
 * The account each transaction's answer names:
 *   1. the mapping rules;
 *   2. the LLM, for what the rules left;
 *   3. uncategorized where neither answered.
 */
async function answerAccounts(
  categorizer: Categorizer,
  transactions: Abacus[],
  accountsByName: AccountsByName,
): Promise<{ accounts: Account[]; report: CategorizationReport }> {
  const { llm } = categorizer;
  // Nothing to categorize: no config to use, and no LLM to ask. The imports
  // that have nothing new rely on this, rather than each deciding what an
  // unasked LLM reports.
  if (transactions.length === 0) {
    return { accounts: [], report: nothingSentReport(llm) };
  }

  // 1. Apply the authoritative executable mappings before asking the LLM.
  const { mapped, unmappedIndices } = partitionByClassifier(
    transactions,
    need(categorizer.classify),
  );

  // 2. Call LLM for unmapped transactions
  let llmMappings: Record<string, Account> = {};
  let report = nothingSentReport(llm);
  if (unmappedIndices.length > 0) {
    ({ mappings: llmMappings, report } = await categorizeViaLLM(
      transactions,
      unmappedIndices,
      {
        promptTemplate: PROMPT_TEMPLATE,
        hledgerAccounts: offeredAccounts(accountsByName),
        customMappings: need(categorizer.customMappings),
        llm,
      },
    ));
  }

  // 3. Combine all mappings
  const allMappings: Record<string, Account> = { ...mapped, ...llmMappings };
  return {
    accounts: transactions.map(
      (t) => allMappings[t.narration] ?? UNCATEGORIZED,
    ),
    report,
  };
}

function partitionByClassifier(
  transactions: Abacus[],
  classify: (transaction: Abacus) => Account | null,
): { mapped: Record<string, Account>; unmappedIndices: number[] } {
  const mapped: Record<string, Account> = {};
  const unmappedIndices: number[] = [];

  transactions.forEach((transaction, index) => {
    if (transaction.narration in mapped) return;

    const account = classify(transaction);
    if (account) mapped[transaction.narration] = account;
    else unmappedIndices.push(index);
  });

  return { mapped, unmappedIndices };
}

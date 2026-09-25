import type { TransactionMappingsView } from "../../../shared/index";

export type ReadMappings = Extract<TransactionMappingsView, { state: "read" }>;

type IncludesRule = ReadMappings["includes"][number];

const matcher = (query: string) => {
  const needle = query.trim().toLowerCase();
  return (text: string) => text.toLowerCase().includes(needle);
};

/**
 * The exact rules as one row per account, most rules first. Each row keeps
 * all its narrations, in file order, and the ones `query` finds, ignoring
 * case: every one when it finds the account, and the row goes when it
 * finds nothing.
 */
export function exactByAccount(mappings: ReadMappings, query = "") {
  const rows = new Map<
    string,
    { account: string; in_ledger: boolean; narrations: string[] }
  >();
  for (const rule of mappings.exact) {
    const row = rows.get(rule.account) ?? {
      account: rule.account,
      in_ledger: rule.in_ledger,
      narrations: [],
    };
    row.narrations.push(rule.narration);
    rows.set(rule.account, row);
  }
  const has = matcher(query);
  return [...rows.values()]
    .sort((a, b) => b.narrations.length - a.narrations.length)
    .map((row) => ({
      ...row,
      found: has(row.account) ? row.narrations : row.narrations.filter(has),
    }))
    .filter((row) => row.found.length > 0);
}

/**
 * The includes rules whose values or account contain `query`, ignoring
 * case. Each keeps its place in the checking order, from 1.
 */
export function findIncludes(
  mappings: ReadMappings,
  query = "",
): (IncludesRule & { position: number })[] {
  const has = matcher(query);
  return mappings.includes
    .map((rule, index) => ({ ...rule, position: index + 1 }))
    .filter((rule) => has(rule.account) || rule.values.some(has));
}

/**
 * A bank description and the account it goes to, shown atop a tab. The
 * kind says what matches: the whole text, a phrase inside a longer one, or
 * nothing, where the AI reads it. A made-up one is `sample`; its account
 * is null when the books have none to name.
 */
export interface RuleExample {
  kind: "whole" | "phrase" | "none";
  text: string;
  account: string | null;
  sample: boolean;
}

/** The first exact rule, or a made-up one. */
export function exactExample(mappings: ReadMappings): RuleExample {
  const rule = mappings.exact[0];
  return rule
    ? {
        kind: "whole",
        text: rule.narration,
        account: rule.account,
        sample: false,
      }
    : {
        kind: "whole",
        text: "ACME SUPERMARKET",
        account: "Groceries",
        sample: true,
      };
}

/** The first includes rule's first value, or a made-up one. */
export function containsExample(mappings: ReadMappings): RuleExample {
  const rule = mappings.includes[0];
  const value = rule?.values[0];
  return rule && value !== undefined
    ? { kind: "phrase", text: value, account: rule.account, sample: false }
    : {
        kind: "phrase",
        text: "CITY POWER",
        account: "Electricity",
        sample: true,
      };
}

// The accounts, in order, the AI's example may go to; the first the books
// have is named.
const AI_EXAMPLE_ACCOUNTS = ["Dining Out", "Food", "Eating Out", "Restaurants"];

/**
 * A made-up description no rule matches, and, when the books have an
 * account it plainly belongs in, that account. A group, the parent of
 * other accounts, is no answer the AI gives.
 */
export function aiExample(
  ledger: readonly { name: string; parent: string | null }[],
): RuleExample {
  const groups = new Set(ledger.map((account) => account.parent));
  const answers = new Set(
    ledger.map((account) => account.name).filter((name) => !groups.has(name)),
  );
  return {
    kind: "none",
    text: "POS 050505 THE BAKERS DOZEN",
    account: AI_EXAMPLE_ACCOUNTS.find((name) => answers.has(name)) ?? null,
    sample: true,
  };
}

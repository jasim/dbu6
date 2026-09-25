import type { TransactionMappingsView } from "../../../shared/index";

export type ReadMappings = Extract<TransactionMappingsView, { state: "read" }>;

/** How many rules the file holds, exact and includes together. */
export function ruleCount(mappings: ReadMappings): number {
  return mappings.exact.length + mappings.includes.length;
}

/**
 * The rules whose narration, values or account contain `query`, ignoring
 * case. Includes rules keep their place in the checking order, so each
 * carries its position in the whole list.
 */
export function filterMappings(mappings: ReadMappings, query: string) {
  const needle = query.trim().toLowerCase();
  const has = (text: string) => text.toLowerCase().includes(needle);
  return {
    exact: mappings.exact.filter(
      (rule) => has(rule.narration) || has(rule.account),
    ),
    includes: mappings.includes
      .map((rule, index) => ({ ...rule, position: index + 1 }))
      .filter((rule) => has(rule.account) || rule.values.some(has)),
  };
}

/** Each account a rule names that the ledger doesn't have, with its rule count. */
export function accountsNotInLedger(
  mappings: ReadMappings,
): { account: string; rules: number }[] {
  const counts = new Map<string, number>();
  for (const rule of [...mappings.exact, ...mappings.includes]) {
    if (rule.in_ledger) continue;
    counts.set(rule.account, (counts.get(rule.account) ?? 0) + 1);
  }
  return [...counts].map(([account, rules]) => ({ account, rules }));
}

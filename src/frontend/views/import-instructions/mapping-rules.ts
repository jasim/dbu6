import { isVpa, type TransactionMappingsView } from "../../../shared/index";

export type ReadMappings = Extract<TransactionMappingsView, { state: "read" }>;

type IncludesRule = ReadMappings["includes"][number];

const matcher = (query: string) => {
  const needle = query.trim().toLowerCase();
  return (text: string) => text.toLowerCase().includes(needle);
};

/**
 * The exact rules as one row per account: first those whose account the
 * books don't have, which the user must fix, then most rules first. Each
 * row keeps all its narrations, in file order, and the ones `query` finds,
 * ignoring case: every one when it finds the account, and the row goes
 * when it finds nothing.
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
    .sort(
      (a, b) =>
        Number(a.in_ledger) - Number(b.in_ledger) ||
        b.narrations.length - a.narrations.length,
    )
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
 * The Exact tab's example: a description an exact rule catches, the
 * user's own first one, else a made-up one, and a longer one it doesn't. A
 * rule that is a UPI address also matches inside a longer description, so
 * it is never the example.
 */
export function exactExample(mappings: ReadMappings): {
  text: string;
  longer: string;
} {
  const text =
    mappings.exact.find((rule) => !isVpa(rule.narration.trim()))?.narration ??
    "ACME GROCERS";
  return { text, longer: `${text} 050505` };
}

/**
 * The Contains tab's example: a phrase, the user's first one, else a
 * made-up one, inside a description a bank might print.
 */
export function containsExample(mappings: ReadMappings): {
  phrase: string;
  before: string;
  after: string;
} {
  return {
    phrase: mappings.includes[0]?.values[0] ?? "CITY POWER",
    before: "NEFT-",
    after: "-050505",
  };
}

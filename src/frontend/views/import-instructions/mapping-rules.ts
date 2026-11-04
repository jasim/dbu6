import {
  isVpa,
  type RuleMoney,
  type StatementScopeView,
  type TransactionMappingsView,
} from "../../../shared/index";
import { formatAmountRange } from "../../format";

export type ReadMappings = Extract<TransactionMappingsView, { state: "read" }>;

type ExactRule = ReadMappings["exact"][number];
type ContainsRule = ReadMappings["contains"][number];

const matcher = (query: string) => {
  const needle = query.trim().toLowerCase();
  return (text: string) => text.toLowerCase().includes(needle);
};

/** The statements a rule reads, as the rules page says it: "On Sample savings". */
export function statementLabel(statement: StatementScopeView): string {
  if (statement.every) return "On every statement";
  return `On ${statement.accounts.map((one) => one.name).join(", ")}`;
}

function moneyLabel(money: RuleMoney): string | null {
  return money === "either" ? null : `money ${money}`;
}

/**
 * What a rule reads and is limited to, statement first:
 * "On Sample savings · money out · up to 5,000".
 */
export function ruleLimits(rule: {
  statement: StatementScopeView;
  money: RuleMoney;
  amount?: { min: number | null; max: number | null } | null;
}): string {
  return [
    statementLabel(rule.statement),
    moneyLabel(rule.money),
    rule.amount ? formatAmountRange(rule.amount) : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/**
 * Whether a rule needs fixing beside it: it reads every statement but
 * answers with an account that has statements of its own, so it is a
 * transfer rule that doesn't say which statement it reads.
 */
export function isUnscopedTransfer(rule: {
  statement: StatementScopeView;
  map_to_has_statements: boolean;
}): boolean {
  return rule.statement.every && rule.map_to_has_statements;
}

/** The statement names a rule reads that the books don't have. */
export function statementsNotInBooks(statement: StatementScopeView): string[] {
  return statement.every
    ? []
    : statement.accounts.filter((one) => !one.in_ledger).map((one) => one.name);
}

function needsFixing(rule: ExactRule): boolean {
  return (
    !rule.in_ledger ||
    isUnscopedTransfer(rule) ||
    statementsNotInBooks(rule.statement).length > 0
  );
}

const scopeKey = (statement: StatementScopeView) =>
  statement.every ? "*" : statement.accounts.map((one) => one.name).join("\n");

export interface ExactRow {
  key: string;
  rule: ExactRule;
  narrations: string[];
  found: string[];
}

/**
 * The exact rules as one row per account, statement and money: first
 * those that need fixing (an account the books don't have, a transfer on
 * every statement), then most descriptions first. Each row keeps all its
 * narrations, in file order, and the ones `query` finds, ignoring case:
 * every one when it finds the account or a statement, and the row goes
 * when it finds nothing.
 */
export function exactByAccount(mappings: ReadMappings, query = ""): ExactRow[] {
  const rows = new Map<
    string,
    { key: string; rule: ExactRule; narrations: string[] }
  >();
  for (const rule of mappings.exact) {
    const key = [
      rule.map_to_account,
      scopeKey(rule.statement),
      rule.money,
    ].join("\t");
    const row = rows.get(key) ?? { key, rule, narrations: [] };
    row.narrations.push(...rule.narrations);
    rows.set(key, row);
  }
  const has = matcher(query);
  return [...rows.values()]
    .sort(
      (a, b) =>
        Number(needsFixing(b.rule)) - Number(needsFixing(a.rule)) ||
        b.narrations.length - a.narrations.length,
    )
    .map((row) => ({
      ...row,
      found:
        has(row.rule.map_to_account) || has(statementLabel(row.rule.statement))
          ? row.narrations
          : row.narrations.filter(has),
    }))
    .filter((row) => row.found.length > 0);
}

/**
 * The contains rules whose texts, account or statements contain `query`,
 * ignoring case. Each keeps its place in the checking order, from 1.
 */
export function findIncludes(
  mappings: ReadMappings,
  query = "",
): (ContainsRule & { position: number })[] {
  const has = matcher(query);
  return mappings.contains
    .map((rule, index) => ({ ...rule, position: index + 1 }))
    .filter(
      (rule) =>
        has(rule.map_to_account) ||
        has(statementLabel(rule.statement)) ||
        rule.contains.some(has),
    );
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
    mappings.exact
      .flatMap((rule) => rule.narrations)
      .find((narration) => !isVpa(narration.trim())) ?? "ACME GROCERS";
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
    phrase: mappings.contains[0]?.contains[0] ?? "CITY POWER",
    before: "NEFT-",
    after: "-050505",
  };
}

import {
  isVpa,
  type AmountRange,
  type ContainsRule,
  type ExactRule,
  type MappingRules,
  type RuleMoney,
  type StatementScope,
} from "../../../shared/index.js";
import { amount, isWithdrawal } from "../values/index.js";
import type { StatementTransaction } from "./CategorizedTransaction.js";

/*
 * The rules in the user's `transaction_mappings.mjs`, compiled and applied.
 * Their shape is the shared schema's (`contracts/categorization-rules.ts`);
 * what they may not hold beyond it, and how a row meets them, is here. The
 * rules get the whole row, statement included, as the LLM does.
 */

interface CompiledExact {
  text: string;
  rule: ExactRule;
}

interface CompiledContains {
  text: string;
  rule: ContainsRule;
}

export interface CompiledMappings {
  // Every exact rule's texts, normalized, with the rules that hold them.
  exact: Map<string, ExactRule[]>;
  // The exact texts that are UPI VPAs (`payee@psp`), in file order. Banks
  // bury the VPA inside a delimited narration (`UPIOUT/<ref>/<vpa>/...`,
  // `UPI-<name>-<vpa>-<ifsc>-...`), so these are also matched against the
  // VPA embedded in a narration, not only against the whole narration.
  vpa: CompiledExact[];
  // One entry per contains text, in file order.
  contains: CompiledContains[];
}

/** Fold away the casing and spacing noise banks add to narrations. */
export function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
}

// A VPA embedded in a narration is bounded by the bank's delimiters (`/`,
// `-`, spaces) or the ends of the text. Letters, digits, and dots continue a
// VPA, so `x@psp` must not match inside `ax@psp` or `x@psp.example`.
const VPA_CHAR = /[A-Z0-9.]/;

function containsVpa(narration: string, vpa: string): boolean {
  let from = 0;
  for (;;) {
    const at = narration.indexOf(vpa, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : narration[at - 1];
    const after = narration[at + vpa.length] ?? "";
    if (!VPA_CHAR.test(before) && !VPA_CHAR.test(after)) return true;
    from = at + 1;
  }
}

// A rule the file may not hold: one that reads the statement of an account
// the books don't have, one that sends a statement's rows to that
// statement's own account, or two exact rules that could answer one row
// with different accounts.
export class MappingRuleError extends Error {
  override readonly name = "MappingRuleError";
}

/** How a rule reads in an error: its kind, its place in the file, its account. */
function describeRule(
  kind: "exact" | "contains",
  index: number,
  rule: ExactRule | ContainsRule,
): string {
  return `${kind} rule ${index + 1} (→ ${JSON.stringify(rule.mapToAccount)})`;
}

function scopesOverlap(a: StatementScope, b: StatementScope): boolean {
  if (a.every || b.every) return true;
  return a.accounts.some((name) => b.accounts.includes(name));
}

function moneyOverlaps(a: RuleMoney, b: RuleMoney): boolean {
  return a === "either" || b === "either" || a === b;
}

// A statement the books don't have would leave the rule reading nothing,
// silently, so it is refused. Its answer may still be an account the books
// don't have yet: that leaves rows uncategorized, and the example rules name
// accounts a new project hasn't made.
function refuseStatementNotInBooks(
  kind: "exact" | "contains",
  index: number,
  rule: ExactRule | ContainsRule,
  accountNames: ReadonlySet<string>,
): void {
  if (rule.statement.every) return;
  for (const name of rule.statement.accounts) {
    if (!accountNames.has(name)) {
      throw new MappingRuleError(
        `${describeRule(kind, index, rule)} reads the statement of ` +
          `${JSON.stringify(name)}, which is not an account in the books. A ` +
          `rule's statement is an account's exact name in Accounts: rename ` +
          `it in the rule, or remove it.`,
      );
    }
  }
}

function refuseSelfMapping(
  kind: "exact" | "contains",
  index: number,
  rule: ExactRule | ContainsRule,
): void {
  if (
    !rule.statement.every &&
    rule.statement.accounts.includes(rule.mapToAccount)
  ) {
    throw new MappingRuleError(
      `${describeRule(kind, index, rule)} reads ${JSON.stringify(rule.mapToAccount)}'s ` +
        `own statement and sends its rows to that same account. A rule's ` +
        `statement is the account whose statement prints the row, never the ` +
        `account the money went to or came from.`,
    );
  }
}

/**
 * The rules, ready for `classifyWith`, against the books' account names.
 * Refuses a rule that reads the statement of an account the books don't
 * have, one that sends a statement's rows to that statement's own account,
 * and two exact rules that could both answer one row with different
 * accounts, so there is never more than one exact answer.
 */
export function compileMappings(
  rules: MappingRules,
  accountNames: ReadonlySet<string>,
): CompiledMappings {
  const exact = new Map<string, ExactRule[]>();
  const vpa: CompiledExact[] = [];
  // The rule each exact rule came from, for its place in an error.
  const indexOf = new Map<ExactRule, number>();

  rules.exact.forEach((rule, index) => {
    refuseStatementNotInBooks("exact", index, rule, accountNames);
    refuseSelfMapping("exact", index, rule);
    indexOf.set(rule, index);
    for (const narration of rule.narrations) {
      const text = normalize(narration);
      const holders = exact.get(text) ?? [];
      if (holders.includes(rule)) continue;
      for (const other of holders) {
        if (
          other.mapToAccount !== rule.mapToAccount &&
          scopesOverlap(other.statement, rule.statement) &&
          moneyOverlaps(other.money, rule.money)
        ) {
          throw new MappingRuleError(
            `${describeRule("exact", index, rule)} and ` +
              `${describeRule("exact", indexOf.get(other)!, other)} both match ` +
              `${JSON.stringify(narration)} on the same statement and the same ` +
              `money, with different accounts. Give each its own statement or ` +
              `money, or keep one.`,
          );
        }
      }
      holders.push(rule);
      exact.set(text, holders);
      if (isVpa(text)) vpa.push({ text, rule });
    }
  });

  rules.contains.forEach((rule, index) => {
    refuseStatementNotInBooks("contains", index, rule, accountNames);
    refuseSelfMapping("contains", index, rule);
  });
  // Flatten to one entry per text so lookup is a single ordered scan.
  const contains = rules.contains.flatMap((rule) =>
    rule.contains.map((text) => ({ text: normalize(text), rule })),
  );

  return { exact, vpa, contains };
}

/** The row's money, relative to its statement's account. */
export function moneyOf(row: StatementTransaction): "in" | "out" {
  return isWithdrawal(row.transaction) ? "out" : "in";
}

/**
 * Whether a rule may answer for a row: it reads the row's statement, the
 * money moved its way, and its answer is not the statement's own account. A
 * row with no statement account meets only rules for every statement.
 */
function applies(
  rule: ExactRule | ContainsRule,
  row: StatementTransaction,
): boolean {
  const { statementAccount } = row;
  if (
    !rule.statement.every &&
    (statementAccount === null ||
      !rule.statement.accounts.includes(statementAccount))
  ) {
    return false;
  }
  if (rule.money !== "either" && rule.money !== moneyOf(row)) return false;
  return rule.mapToAccount !== statementAccount;
}

/**
 * The account a row's rules answer, or null. Only the rules that apply to
 * the row are checked (`applies`), in this order: the whole narration
 * against the exact texts; then each VPA text, in file order, against the
 * VPA embedded in the narration; then each contains text, in file order, in
 * its amount range. Narrower phrases must be declared ahead of broader ones.
 */
export function classifyWith(
  compiled: CompiledMappings,
  row: StatementTransaction,
): string | null {
  const narration = normalize(row.transaction.narration);

  const exactRule = compiled.exact
    .get(narration)
    ?.find((rule) => applies(rule, row));
  if (exactRule) return exactRule.mapToAccount;

  for (const { text, rule } of compiled.vpa) {
    if (applies(rule, row) && containsVpa(narration, text)) {
      return rule.mapToAccount;
    }
  }

  const moved = amount(row.transaction);
  for (const { text, rule } of compiled.contains) {
    if (!applies(rule, row)) continue;
    if (rule.amount && !inRange(moved, rule.amount)) continue;
    if (narration.includes(text)) return rule.mapToAccount;
  }

  return null;
}

function inRange(value: number, range: AmountRange): boolean {
  return (
    (range.min === undefined || value >= range.min) &&
    (range.max === undefined || value <= range.max)
  );
}

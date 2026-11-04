import { z } from "zod";
import { isVpa } from "../../../shared/index.js";
import { amount, isWithdrawal } from "../values/index.js";
import type { StatementTransaction } from "./CategorizedTransaction.js";

/*
 * The rules in the user's `transaction_mappings.mjs`. Each rule reads one
 * statement's rows (or several statements', or every statement's) and says
 * where money moving one way, with a description like this, went or came
 * from. The rules get the whole row, statement included, as the LLM does.
 */

const accountNameSchema = z.string().trim().min(1);
const textSchema = z.string().trim().min(1);

// Every statement, or the accounts whose statements a rule reads, by name.
export type StatementScope =
  { every: true } | { every: false; accounts: readonly string[] };

export const EVERY_STATEMENT = "*";

// `"*"`, one account's name, or a list of names. The one place `"*"` is read.
const statementScopeSchema = z
  .union([accountNameSchema, z.array(accountNameSchema).min(1)])
  .superRefine((value, ctx) => {
    if (Array.isArray(value) && value.includes(EVERY_STATEMENT)) {
      ctx.addIssue({
        code: "custom",
        message: `"${EVERY_STATEMENT}" means every statement; write it alone, not in a list`,
      });
    }
  })
  .transform((value): StatementScope => {
    if (value === EVERY_STATEMENT) return { every: true };
    const names = typeof value === "string" ? [value] : value;
    return { every: false, accounts: [...new Set(names)] };
  });

// Which way the money moved, relative to the statement's account. On a
// card's statement, a bill payment is "in".
const moneySchema = z.enum(["in", "out", "either"]);
export type Money = z.infer<typeof moneySchema>;

// The amounts a rule applies to, both ends included, compared with the
// amount that moved, whichever way. Either end may be left open.
const amountRangeSchema = z
  .object({
    min: z.number().nonnegative().optional(),
    max: z.number().nonnegative().optional(),
  })
  .strict()
  .refine((range) => range.min !== undefined || range.max !== undefined, {
    message: "an amount range needs a min, a max, or both",
  })
  .refine(
    (range) =>
      range.min === undefined ||
      range.max === undefined ||
      range.min <= range.max,
    { message: "an amount range's min is above its max" },
  );
export type AmountRange = z.infer<typeof amountRangeSchema>;

export const exactRuleSchema = z
  .object({
    statement: statementScopeSchema,
    money: moneySchema,
    narrations: z.array(textSchema).min(1),
    mapToAccount: accountNameSchema,
  })
  .strict();

export const containsRuleSchema = z
  .object({
    statement: statementScopeSchema,
    money: moneySchema,
    contains: z.array(textSchema).min(1),
    amount: amountRangeSchema.optional(),
    mapToAccount: accountNameSchema,
  })
  .strict();

export type ExactRule = z.output<typeof exactRuleSchema>;
export type ContainsRule = z.output<typeof containsRuleSchema>;

/**
 * Shape of the `mappings` export in the user's `transaction_mappings.mjs`.
 * User-authored, so it is parsed rather than trusted.
 */
export const mappingRulesSchema = z
  .object({
    exact: z.array(exactRuleSchema),
    contains: z.array(containsRuleSchema),
  })
  .strict();

// The rules, parsed: what the engine and the rules page read.
export type MappingRules = z.output<typeof mappingRulesSchema>;
// The rules as the file writes them.
export type MappingRulesFile = z.input<typeof mappingRulesSchema>;

// One rule as `/api/categorization-rules/preview` takes it: either kind, in
// the file's shape.
export const oneRuleSchema = z.union([exactRuleSchema, containsRuleSchema]);
export type OneRule = z.output<typeof oneRuleSchema>;

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

// A rule the file may not hold: one that sends a statement's rows to that
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

/** The statement scope as the file writes it, for a message. */
export function describeScope(scope: StatementScope): string {
  if (scope.every) return JSON.stringify(EVERY_STATEMENT);
  return scope.accounts.map((name) => JSON.stringify(name)).join(", ");
}

function scopesOverlap(a: StatementScope, b: StatementScope): boolean {
  if (a.every || b.every) return true;
  return a.accounts.some((name) => b.accounts.includes(name));
}

function moneyOverlaps(a: Money, b: Money): boolean {
  return a === "either" || b === "either" || a === b;
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
 * The rules, ready for `classifyWith`. Refuses a rule that sends a
 * statement's rows to that statement's own account, and two exact rules that
 * could both answer one row with different accounts, so there is never more
 * than one exact answer.
 */
export function compileMappings(rules: MappingRules): CompiledMappings {
  const exact = new Map<string, ExactRule[]>();
  const vpa: CompiledExact[] = [];
  // The rule each exact rule came from, for its place in an error.
  const indexOf = new Map<ExactRule, number>();

  rules.exact.forEach((rule, index) => {
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

  rules.contains.forEach((rule, index) =>
    refuseSelfMapping("contains", index, rule),
  );
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

/** The rules of one rule, for running it alone through `classifyWith`. */
export function rulesOfOne(rule: OneRule): MappingRules {
  return "narrations" in rule
    ? { exact: [rule], contains: [] }
    : { exact: [], contains: [rule] };
}

import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

const c = initContract();

const errorSchema = z.object({ error: z.string() }).passthrough();

/*
 * The rules in the user's `user-config/transaction_mappings.mjs`: the file's
 * shape, which the categorizer parses it with, and the preview endpoint that
 * tries one rule before it is written. Each rule reads one statement's rows
 * (or several statements', or every statement's) and says where money
 * moving one way, with a description like this, went or came from. What the
 * rules may not hold beyond this shape is categorization's
 * (`compileMappings`).
 */

const accountNameSchema = z.string().trim().min(1);
const textSchema = z.string().trim().min(1);

// Every statement, or the accounts whose statements a rule reads, by name.
export type StatementScope =
  { every: true } | { every: false; accounts: string[] };

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
export const ruleMoneySchema = z.enum(["in", "out", "either"]);
export type RuleMoney = z.infer<typeof ruleMoneySchema>;

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
    money: ruleMoneySchema,
    narrations: z.array(textSchema).min(1),
    mapToAccount: accountNameSchema,
  })
  .strict();

export const containsRuleSchema = z
  .object({
    statement: statementScopeSchema,
    money: ruleMoneySchema,
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

// One rule as the preview takes it: either kind, in the file's shape.
export const oneRuleSchema = z.union([exactRuleSchema, containsRuleSchema]);
export type OneRule = z.output<typeof oneRuleSchema>;

export const rulePreviewStatementSchema = z.object({
  // The account whose statement prints the rows; null for rows of no ledger
  // account's statement.
  statement: z.string().nullable(),
  drafts: z.number().int().nonnegative(),
  posted: z.number().int().nonnegative(),
  // The amounts moved, least and most.
  least: z.number(),
  most: z.number(),
  // Where those rows sit now, most first; null for a draft with no account.
  now_in: z.array(
    z.object({ account: z.string().nullable(), count: z.number().int() }),
  ),
});

export const rulePreviewSchema = z.object({
  // Most rows first.
  statements: z.array(rulePreviewStatementSchema),
});
export type RulePreviewView = z.infer<typeof rulePreviewSchema>;

export const categorizationRulesContract = c.router({
  previewCategorizationRule: c.mutation({
    method: "POST",
    path: "/categorization-rules/preview",
    summary:
      "What one categorization rule would catch, per statement, among the drafts and the books. Reads only.",
    description:
      "The body is { rule }: one exact or contains rule, as transaction_mappings.mjs holds it. It is matched on its own: rules earlier in the file may answer some of these rows first. A body not in that shape is a 400; a rule the file would refuse, such as one naming a statement that is not an account, is a 422 saying why.",
    body: z.object({ rule: oneRuleSchema }),
    responses: {
      200: rulePreviewSchema,
      403: errorSchema,
      422: errorSchema,
    },
  }),
});

import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

const c = initContract();

const errorSchema = z.object({ error: z.string() }).passthrough();

/*
 * The rules in user-config/transaction_mappings.mjs, tried before they are
 * written: one rule, run through the categorizer's own matching over the
 * drafts and the books.
 */

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
      'The body is { rule }: one exact rule ({ statement, money, narrations, mapToAccount }) or contains rule ({ statement, money, contains, amount?, mapToAccount }), in transaction_mappings.mjs\'s shape. `statement` is an account name, a list of names, or "*"; `money` is "in", "out" or "either". A rule the file would refuse is a 422 saying why.',
    body: z.object({ rule: z.record(z.string(), z.unknown()) }),
    responses: {
      200: rulePreviewSchema,
      403: errorSchema,
      422: errorSchema,
    },
  }),
});

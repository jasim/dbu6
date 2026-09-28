import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

const c = initContract();

const errorSchema = z.object({ error: z.string() }).passthrough();

/*
 * Rule requests for the categoriser, made on Review's Improve categorization
 * tab (schema/categorization-rule-requests.ts). The user's coding agent turns
 * each into a rule or guidance, and then deletes it; the categorizer then
 * gives the drafts their account.
 */

// A draft in a rule request, as its statement showed it. The amount is what
// moved, in `direction`.
export const categorizationRuleRequestTransactionSchema = z.object({
  date: z.string(),
  source_narration: z.string(),
  direction: z.enum(["withdrawal", "deposit"]),
  amount: z.number().nonnegative(),
});
export type CategorizationRuleRequestTransaction = z.infer<
  typeof categorizationRuleRequestTransactionSchema
>;

export const categorizationRuleRequestSchema = z.object({
  id: z.number().int(),
  // The statement account the drafts were imported for.
  base_account_id: z.number().int(),
  // Where the user said the drafts go.
  account: z.object({ id: z.number().int(), name: z.string() }),
  // Oldest first.
  transactions: z.array(categorizationRuleRequestTransactionSchema).min(1),
  // What the user added for next time, or "".
  note: z.string(),
});
export type CategorizationRuleRequest = z.infer<
  typeof categorizationRuleRequestSchema
>;

export const categorizationRuleRequestsContract = c.router({
  listCategorizationRuleRequests: c.query({
    method: "GET",
    path: "/categorization-rule-requests",
    summary: "The rule requests waiting for the coding agent, for one account",
    query: z.object({
      base_account_id: z.coerce.number().int().positive(),
    }),
    responses: {
      200: z.object({
        rule_requests: z.array(categorizationRuleRequestSchema),
      }),
      403: errorSchema,
    },
  }),
  requestCategorizationRule: c.mutation({
    method: "POST",
    path: "/categorization-rule-requests",
    summary:
      "Record that drafts of one statement account go to an account, as a rule request for the coding agent; the drafts stay without an account",
    body: z.object({
      draft_ids: z.array(z.number().int().positive()).min(1),
      account_id: z.number().int().positive(),
      note: z.string().default(""),
    }),
    responses: {
      200: z.object({ rule_request: categorizationRuleRequestSchema }),
      403: errorSchema,
      // The account, or one of the drafts, isn't in the books.
      404: errorSchema,
      // The account is the drafts' own statement account, or the drafts
      // belong to more than one.
      422: errorSchema,
    },
  }),
  deleteCategorizationRuleRequest: c.mutation({
    method: "DELETE",
    path: "/categorization-rule-requests/:id",
    summary:
      "Delete a rule request once it is encoded, or when the user no longer wants it",
    pathParams: z.object({ id: z.coerce.number().int().positive() }),
    body: z.object({}).optional(),
    responses: {
      200: z.object({ deleted: z.number() }),
      403: errorSchema,
      404: errorSchema,
    },
  }),
  clearCategorizationRuleRequests: c.mutation({
    method: "DELETE",
    path: "/categorization-rule-requests",
    summary: "Delete every rule request of one statement account",
    query: z.object({
      base_account_id: z.coerce.number().int().positive(),
    }),
    body: z.object({}).optional(),
    responses: {
      200: z.object({ deleted: z.number() }),
      403: errorSchema,
    },
  }),
});

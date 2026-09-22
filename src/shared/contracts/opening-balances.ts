import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { isoDate } from "./reports.js";

const c = initContract();

/*
 * Opening balances: what each asset and liability account held or owed
 * before its first transaction, recorded as the account's opening entry
 * against Opening Balances (Equity). Amounts are signed like a balance
 * assertion: positive when held, negative when owed.
 */

export const openingEntrySchema = z.object({
  journal_id: z.number(),
  date: z.string(),
  amount: z.number(),
  /** Its journal's description: where the balance came from. */
  description: z.string(),
});
export type OpeningEntry = z.infer<typeof openingEntrySchema>;

export const openingBalanceAccountSchema = z.object({
  account_id: z.number(),
  name: z.string(),
  path: z.string(),
  account_type: z.enum(["Asset", "Liability"]),
  // The account's first posted entry or draft; null with neither.
  first_activity_date: z.string().nullable(),
  // The day before it; null when the user has to pick the date.
  default_date: z.string().nullable(),
  // What the first balance check implies, for an account with drafts and
  // nothing posted; null otherwise.
  suggested_amount: z.number().nullable(),
  // Null until the account has an opening entry.
  opening: openingEntrySchema.nullable(),
});
export type OpeningBalanceAccount = z.infer<typeof openingBalanceAccountSchema>;

const namedAccountSchema = z.object({ id: z.number(), name: z.string() });

export const openingBalancesSchema = z.object({
  // Null until the first opening entry creates it.
  equity_account: namedAccountSchema.nullable(),
  accounts: z.array(openingBalanceAccountSchema),
});
export type OpeningBalances = z.infer<typeof openingBalancesSchema>;

export const openingBalanceRefusalSchema = z.object({
  error: z.string(),
  code: z.enum([
    "not_asset_or_liability",
    "already_recorded",
    "date_not_before_first_activity",
    "opening_balances_not_equity",
  ]),
  first_activity_date: z.string().optional(),
});
export type OpeningBalanceRefusal = z.infer<typeof openingBalanceRefusalSchema>;

export const openingBalancesContract = c.router({
  list: c.query({
    method: "GET",
    path: "/opening-balances",
    summary: "Every asset and liability account with its opening entry",
    query: z.object({}),
    responses: {
      200: openingBalancesSchema,
      403: errorBodySchema,
    },
  }),
  record: c.mutation({
    method: "POST",
    path: "/opening-balances",
    summary:
      "Post an account's opening entry against Opening Balances (Equity)",
    body: z.object({
      account_id: z.number().int().positive(),
      // Before the account's first posted entry or draft.
      date: isoDate,
      // Positive when held, negative when owed; also the balance assertion.
      amount: z.number().finite(),
      // Where the balance came from, in the user's words; it becomes the
      // journal's description. Left out, the journal is "Opening balance".
      description: z.string().max(200).optional(),
    }),
    responses: {
      201: z.object({
        journal_id: z.number(),
        equity_account: namedAccountSchema,
        equity_account_created: z.boolean(),
      }),
      403: errorBodySchema,
      404: errorBodySchema,
      422: openingBalanceRefusalSchema,
    },
  }),
});

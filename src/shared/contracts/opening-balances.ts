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

// Why an opening entry can't be changed or removed in place, where
// the user changes its journal entry instead.
export const openingLockSchema = z.enum([
  // A posted entry on the account besides its opening entry.
  "has_entries",
  // Its journal opens other accounts too, or has more than the account's
  // line and one Equity line.
  "shared_entry",
]);
export type OpeningLock = z.infer<typeof openingLockSchema>;

export const openingEntrySchema = z.object({
  journal_id: z.number(),
  date: z.string(),
  amount: z.number(),
  /** Its journal's description: where the balance came from. */
  description: z.string(),
  // Null while the entry can be changed or removed.
  locked: openingLockSchema.nullable(),
});
export type OpeningEntry = z.infer<typeof openingEntrySchema>;

// Where the Opening balances page lists an account: an asset or a liability no
// statement comes from, or a bank or card an import preset lists.
export const openingSectionSchema = z.enum(["own", "owe", "statement"]);
export type OpeningSection = z.infer<typeof openingSectionSchema>;

export const openingBalanceAccountSchema = z.object({
  account_id: z.number(),
  name: z.string(),
  path: z.string(),
  account_type: z.enum(["Asset", "Liability"]),
  // Null for an account with accounts under it and no opening entry.
  section: openingSectionSchema.nullable(),
  // The account's first posted entry outside its opening entry, or its
  // first draft, from its own statements or categorized to it; null with
  // neither.
  first_activity_date: z.string().nullable(),
  // The day before it; with neither, the day the books start (their
  // earliest opening entry); null when the books have no opening entry.
  default_date: z.string().nullable(),
  // What the first balance check implies, while nothing but the opening
  // entry is posted on the account; null otherwise.
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
    "account_not_found",
    "not_asset_or_liability",
    "already_recorded",
    "not_recorded",
    "account_has_entries",
    "opening_entry_shared",
    "date_not_before_first_activity",
    "opening_balances_not_equity",
  ]),
  first_activity_date: z.string().optional(),
  // The opening journal, on a lock refusal: where to change it instead.
  journal_id: z.number().optional(),
});
export type OpeningBalanceRefusal = z.infer<typeof openingBalanceRefusalSchema>;

const openingBalanceBody = z.object({
  // Before the account's first posted entry or draft.
  date: isoDate,
  // Positive when held, negative when owed; also the balance assertion.
  amount: z.number().finite(),
  // Where the balance came from, in the user's words; it becomes the
  // journal's description. Left out, the journal is "Opening balance".
  description: z.string().max(200).optional(),
});

const accountParams = z.object({
  accountId: z.coerce.number().int().positive(),
});

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
    body: openingBalanceBody.extend({
      account_id: z.number().int().positive(),
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
  change: c.mutation({
    method: "PUT",
    path: "/opening-balances/:accountId",
    summary:
      "Change an account's opening entry in place, while no other posted entry is on the account and the entry opens it alone",
    pathParams: accountParams,
    body: openingBalanceBody,
    responses: {
      200: z.object({ journal_id: z.number() }),
      403: errorBodySchema,
      404: openingBalanceRefusalSchema,
      409: openingBalanceRefusalSchema,
      422: openingBalanceRefusalSchema,
    },
  }),
  remove: c.mutation({
    method: "DELETE",
    path: "/opening-balances/:accountId",
    summary:
      "Delete an account's opening entry, while no other posted entry is on the account and the entry opens it alone",
    pathParams: accountParams,
    body: z.object({}).optional(),
    responses: {
      200: z.object({ removed_journal_id: z.number() }),
      403: errorBodySchema,
      404: openingBalanceRefusalSchema,
      409: openingBalanceRefusalSchema,
    },
  }),
});

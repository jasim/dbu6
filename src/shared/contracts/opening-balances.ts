import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { isoDate } from "./dates.js";

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

// Where an opening balance came from: its statements, while it is the
// opening their first balance check implies, else entered by hand.
export const openingSourceSchema = z.enum(["statement", "manual"]);
export type OpeningSource = z.infer<typeof openingSourceSchema>;

export const openingEntrySchema = z.object({
  journal_id: z.number(),
  date: z.string(),
  amount: z.number(),
  /** Its journal's description: where the balance came from. */
  description: z.string(),
  // Null while the entry can be changed or removed.
  locked: openingLockSchema.nullable(),
  source: openingSourceSchema,
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
  // The opening balance its first balance check implies; null with none.
  implied_opening: z.number().nullable(),
  // Null until the account has an opening entry.
  opening: openingEntrySchema.nullable(),
});
export type OpeningBalanceAccount = z.infer<typeof openingBalanceAccountSchema>;

const namedAccountSchema = z.object({ id: z.number(), name: z.string() });

// An account as the check and the wrong-side list name it.
export const balanceAccountRefSchema = z.object({
  account_id: z.number(),
  name: z.string(),
  path: z.string(),
  account_type: z.enum(["Asset", "Liability"]),
});
export type BalanceAccountRef = z.infer<typeof balanceAccountRefSchema>;

export const wrongSideBalanceSchema = balanceAccountRefSchema.extend({
  // Posted entries plus drafts; positive when held, negative when owed.
  balance: z.number(),
});
export type WrongSideBalance = z.infer<typeof wrongSideBalanceSchema>;

export const openingBalancesSchema = z.object({
  // Null until the first opening entry creates it.
  equity_account: namedAccountSchema.nullable(),
  accounts: z.array(openingBalanceAccountSchema),
  // The accounts whose start nobody has answered for: every leaf asset or
  // liability account with no opening entry, by path. Not a group with
  // accounts under it, nor `empty_groups`. An opening of 0 answers "it
  // started here".
  unanswered: z.array(balanceAccountRefSchema),
  // The groups banks, cards and loans are added under, while nothing is on
  // them and nothing under them: off the check, since nothing in the books
  // says whether one waits for accounts or is one.
  empty_groups: z.array(balanceAccountRefSchema),
  // Accounts whose balance, drafts included, is on the wrong side for their
  // type: an asset in credit, a liability in debit. Worth a look, not an
  // error: a card paid in excess or an overdrawn account is ordinary.
  wrong_side: z.array(wrongSideBalanceSchema),
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
  // The day the balance is from. Changing an opening takes a day before the
  // account's first posted entry or draft.
  date: isoDate,
  // The balance at the end of that day: positive when held, negative when
  // owed.
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
    summary:
      "Every asset and liability account with its opening entry, the accounts with no starting balance, and balances on the wrong side",
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
      "Post an account's opening entry against Opening Balances (Equity). A date on or after the account's first activity is a balance known then: the opening posted is that balance less the account's movement through the day (posted entries and drafts, as its running balance adds them up), dated the day before its first activity. The answer gives the date and amount posted",
    body: openingBalanceBody.extend({
      account_id: z.number().int().positive(),
    }),
    responses: {
      201: z.object({
        journal_id: z.number(),
        equity_account: namedAccountSchema,
        equity_account_created: z.boolean(),
        // The opening as posted, worked back when the date was later.
        date: isoDate,
        amount: z.number(),
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

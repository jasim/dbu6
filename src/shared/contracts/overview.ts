import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { accountKindSchema } from "./account-kind.js";

const c = initContract();

const yearMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected a month as YYYY-MM");

/**
 * One importable account on Overview: its balance at the month's end and the
 * date its books are complete until, its last posted balance check.
 */
export const overviewAccountSchema = z.object({
  account_id: z.number(),
  name: z.string(),
  kind: accountKindSchema,
  // What it holds, or for a card what is owed on it, at the month's end.
  balance: z.number(),
  // Its last posted balance check; null before the first.
  books_until: z.string().nullable(),
});
export type OverviewAccount = z.infer<typeof overviewAccountSchema>;

/** A spending category: the month's amount beside its usual one. */
export const overviewCategorySchema = z.object({
  account_id: z.number(),
  name: z.string(),
  amount: z.number(),
  // Over the same months as the figures' average; null when there are none.
  average: z.number().nullable(),
});
export type OverviewCategory = z.infer<typeof overviewCategorySchema>;

/**
 * Where net worth sits: an account at the first level of the asset or
 * liability tree that branches, with everything under it; or, with no
 * account, the rest past the limit.
 */
export const overviewWorthGroupSchema = z.object({
  account_id: z.number().nullable(),
  name: z.string(),
  amount: z.number(),
});
export type OverviewWorthGroup = z.infer<typeof overviewWorthGroupSchema>;

// What the books show for the month, once anything is posted.
const postedOverviewSchema = z.object({
  posted: z.literal(true),
  // The month shown: the one asked for, or else the current month.
  month: yearMonth,
  // The first month with any income or spending entry.
  first_month: yearMonth.nullable(),
  figures: z.object({
    income: z.number(),
    spending: z.number(),
    // Over the up to twelve months before `month` that the books cover
    // (from `first_month`), and how many those are; null when there are none.
    average: z
      .object({ months: z.number(), income: z.number(), spending: z.number() })
      .nullable(),
  }),
  // The first level of the spending tree that branches, largest first, up to
  // a limit. Amounts are positive; a refund makes one smaller.
  categories: z.array(overviewCategorySchema),
  // The twelve months ending with `month`, zero-filled.
  months: z.array(
    z.object({ month: yearMonth, income: z.number(), spending: z.number() }),
  ),
  // At the month's end, and `previous_net` at the month before's.
  net_worth: z.object({
    assets: z.number(),
    liabilities: z.number(),
    net: z.number(),
    previous_net: z.number(),
    // At the month's end, largest first, up to five with the last of them
    // Other; empty when the level has a single account. Owed is positive.
    asset_groups: z.array(overviewWorthGroupSchema),
    liability_groups: z.array(overviewWorthGroupSchema),
  }),
  // The importable accounts the ledger has, as Update orders them.
  accounts: z.array(overviewAccountSchema),
});
export type PostedOverview = z.infer<typeof postedOverviewSchema>;

// Until the books hold a posted journal beyond the accounts' opening entries
// (`hasJournalsBesideOpenings`), there is nothing to show.
export const overviewSchema = z.discriminatedUnion("posted", [
  z.object({ posted: z.literal(false) }),
  postedOverviewSchema,
]);
export type Overview = z.infer<typeof overviewSchema>;

export const overviewContract = c.router({
  overview: c.query({
    method: "GET",
    path: "/overview",
    summary:
      "Where the money stands for one month, for the Overview screen. Posted entries only, never drafts; `posted: false` until anything beyond opening balances is posted.",
    query: z.object({ month: yearMonth.optional() }),
    responses: {
      200: overviewSchema,
      400: errorBodySchema,
      403: errorBodySchema,
    },
  }),
});

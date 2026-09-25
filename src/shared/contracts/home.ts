import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { accountKindSchema } from "./account-kind.js";
import { datedBalanceSchema } from "./dated-balance.js";
import { draftCountsSchema } from "./posting-checks.js";

const c = initContract();

const importableAccountFields = {
  account_id: z.number(),
  // The preset account's name.
  name: z.string(),
  kind: accountKindSchema,
  // Whether its institution lists a parser. Without one its statements
  // can't be imported yet: dropping them at /add teaches dbu6 the format.
  has_parser: z.boolean(),
};

/**
 * One importable account, as Home lists it: an account of an import preset.
 * When the ledger has it, where its books stand and what is waiting in its
 * drafts. When the ledger account was deleted, the preset still names its id,
 * and Home says so.
 */
export const homeAccountSchema = z.discriminatedUnion("in_ledger", [
  z.object({
    in_ledger: z.literal(false),
    ...importableAccountFields,
  }),
  z.object({
    in_ledger: z.literal(true),
    ...importableAccountFields,
    // The ledger account's name.
    path: z.string(),
    // The last posted balance assertion; null before the first.
    checkpoint: datedBalanceSchema.nullable(),
    // Posted balance assertions its books miss: an entry changed after the
    // statement was added. The Reconciliation Differences report lists them.
    statement_differences: z.number(),
    ...draftCountsSchema.shape,
  }),
]);
export type HomeAccount = z.infer<typeof homeAccountSchema>;
export type HomeLedgerAccount = Extract<HomeAccount, { in_ledger: true }>;

export const homeSummarySchema = z.object({
  // Whether the books have a chart of accounts: any account at all, the
  // rule /setup's chart card and its create follow (`hasChart`).
  has_chart: z.boolean(),
  // Oldest balance assertion first; accounts without one lead.
  accounts: z.array(homeAccountSchema),
  // Over every draft, including ones on accounts no preset lists.
  totals: draftCountsSchema,
  // Whether any listed account in the books has transactions from its own
  // statements, entries or drafts (`hasTransactions`, as /add places an
  // account): an opening entry alone is not an import.
  any_imported: z.boolean(),
});
export type HomeSummary = z.infer<typeof homeSummarySchema>;

export const homeContract = c.router({
  summary: c.query({
    method: "GET",
    path: "/home",
    summary: "Where the books stand, for the Home screen",
    query: z.object({}),
    responses: {
      200: homeSummarySchema,
      403: errorBodySchema,
    },
  }),
});

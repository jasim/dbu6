import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { accountKindSchema } from "./account-kind.js";
import { datedBalanceSchema } from "./dated-balance.js";
import { draftCountsSchema } from "./posting-checks.js";

const c = initContract();

const importableAccountFields = {
  path: z.string(),
  // The preset's name when one preset points here, else a readable segment.
  name: z.string(),
  kind: accountKindSchema,
};

/**
 * One importable account, as Home lists it: an account named as a base
 * account by at least one import preset. When the ledger has it, where its
 * books stand and what is waiting in its drafts; when a preset names an
 * account the ledger does not have, neither.
 */
export const homeAccountSchema = z.discriminatedUnion("in_ledger", [
  z.object({
    in_ledger: z.literal(false),
    ...importableAccountFields,
  }),
  z.object({
    in_ledger: z.literal(true),
    account_id: z.number(),
    ...importableAccountFields,
    // The last posted balance assertion; null before the first.
    checkpoint: datedBalanceSchema.nullable(),
    ...draftCountsSchema.shape,
  }),
]);
export type HomeAccount = z.infer<typeof homeAccountSchema>;
export type HomeLedgerAccount = Extract<HomeAccount, { in_ledger: true }>;

export const homeSummarySchema = z.object({
  // Oldest balance assertion first; accounts without one lead.
  accounts: z.array(homeAccountSchema),
  // Over every draft, including ones on accounts no preset names.
  totals: draftCountsSchema,
  // Whether any listed account has posted entries.
  has_journals: z.boolean(),
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

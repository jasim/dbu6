import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { accountKindSchema } from "./account-kind.js";
import { draftCountsSchema } from "./posting-blocks.js";

const c = initContract();

/**
 * One importable account, as Home lists it: an account named as a base
 * account by at least one import preset, with where its books stand and
 * what is waiting in its drafts.
 */
export const homeAccountSchema = z.object({
  // Null when a preset names an account the ledger does not have.
  account_id: z.number().nullable(),
  path: z.string(),
  // The preset's name when one preset points here, else a readable segment.
  name: z.string(),
  kind: accountKindSchema,
  // The last posted balance assertion: its date and figure.
  checked_to: z.string().nullable(),
  checked_balance: z.number().nullable(),
  ...draftCountsSchema.shape,
});
export type HomeAccount = z.infer<typeof homeAccountSchema>;

export const homeSummarySchema = z.object({
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

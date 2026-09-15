import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { accountKindSchema } from "./account-kind.js";
import { draftCountsSchema } from "./posting-blocks.js";

const c = initContract();

/**
 * A ledger account as Review lists it: its drafts and what blocks adding
 * them to the books. The counts are the draft reports' rows.
 */
export const reviewAccountSchema = z.object({
  account_id: z.number(),
  path: z.string(),
  // The preset's name when one preset imports here, else a readable segment.
  name: z.string(),
  kind: accountKindSchema,
  ...draftCountsSchema.shape,
  // The drafts' first and last dates; null when there are none.
  first_date: z.string().nullable(),
  last_date: z.string().nullable(),
});
export type ReviewAccount = z.infer<typeof reviewAccountSchema>;

/** A draft whose running balance misses the balance its statement printed. */
export const reviewFailingCheckSchema = z.object({
  date: z.string(),
  draft_id: z.number(),
  running_balance: z.number(),
  assertion: z.number(),
  diff: z.number(),
});
export type ReviewFailingCheck = z.infer<typeof reviewFailingCheckSchema>;

/** A draft that looks like another draft or an entry already posted. */
export const reviewDuplicateSchema = z.object({
  date: z.string(),
  draft_id: z.number(),
  other_draft_id: z.number().nullable(),
  matched_journal_id: z.number().nullable(),
  matched_journal_entry_id: z.number().nullable(),
  match_kind: z.enum(["draft-draft", "draft-journal"]),
  match_type: z.string(),
  confidence: z.number(),
  direction: z.enum(["deposit", "withdrawal"]),
  amount: z.number(),
  narration: z.string(),
  // The other draft's narration, or the matched entry's comment.
  other_narration: z.string().nullable(),
  draft_category: z.string().nullable(),
  // The other draft's category, or the matched entry's account.
  matched_category: z.string().nullable(),
});
export type ReviewDuplicate = z.infer<typeof reviewDuplicateSchema>;

export const reviewAccountDetailSchema = z.object({
  // `drafts` may be 0: everything imported is already in the books.
  account: reviewAccountSchema,
  // The last posted balance assertion on the account.
  checked_to: z.string().nullable(),
  checked_balance: z.number().nullable(),
  // Drafts carrying a statement balance, and the last of them.
  balance_checks: z.number(),
  closing: z.object({ date: z.string(), balance: z.number() }).nullable(),
  failing: z.array(reviewFailingCheckSchema),
  duplicates: z.array(reviewDuplicateSchema),
  // The other accounts with drafts, by name.
  other_accounts: z.array(
    z.object({ account_id: z.number(), name: z.string(), drafts: z.number() }),
  ),
});
export type ReviewAccountDetail = z.infer<typeof reviewAccountDetailSchema>;

export const reviewContract = c.router({
  accounts: c.query({
    method: "GET",
    path: "/review/accounts",
    summary: "The accounts with drafts to review, by name",
    query: z.object({}),
    responses: {
      200: z.object({ accounts: z.array(reviewAccountSchema) }),
      403: errorBodySchema,
    },
  }),
  account: c.query({
    method: "GET",
    path: "/review/accounts/:accountId",
    summary: "One account's drafts and what blocks adding them to the books",
    pathParams: z.object({ accountId: z.coerce.number().int().positive() }),
    query: z.object({}),
    responses: {
      200: reviewAccountDetailSchema,
      403: errorBodySchema,
      404: errorBodySchema,
    },
  }),
});

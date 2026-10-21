import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { ledgerAccountTypeSchema } from "./setup.js";

const c = initContract();

/** A posted journal that matched, with what a result line shows of it. */
export const searchJournalSchema = z.object({
  id: z.number(),
  date: z.string(),
  description: z.string(),
  // The journal's total debit: how much moved.
  amount: z.number(),
  // Its entries in the order they were made, each with its own text: the
  // search may have matched an entry rather than the description.
  entries: z.array(
    z.object({
      account: z.string(),
      debit: z.number(),
      credit: z.number(),
      comment: z.string().nullable(),
      narration: z.string().nullable(),
      reference: z.string().nullable(),
    }),
  ),
});
export type SearchJournal = z.infer<typeof searchJournalSchema>;

/** A statement row still in the drafts that matched. */
export const searchDraftSchema = z.object({
  id: z.number(),
  date: z.string(),
  narration: z.string(),
  comment: z.string().nullable(),
  // Deposit minus withdrawal: money in is positive.
  amount: z.number(),
  base_account_id: z.number().nullable(),
  base_account_name: z.string().nullable(),
  // The category; null until categorized.
  account_name: z.string().nullable(),
});
export type SearchDraft = z.infer<typeof searchDraftSchema>;

export const searchAccountSchema = z.object({
  id: z.number(),
  name: z.string(),
  account_type: ledgerAccountTypeSchema,
  // Where it sits, "Expenses > Kitchen"; null for a top account.
  parent_path: z.string().nullable(),
});
export type SearchAccount = z.infer<typeof searchAccountSchema>;

export const searchResultsSchema = z.object({
  // The words every result matched, as the search read them.
  words: z.array(z.string()),
  // Newest first, at most SEARCH_LIMIT of each.
  journals: z.array(searchJournalSchema),
  drafts: z.array(searchDraftSchema),
  accounts: z.array(searchAccountSchema),
  // Whether more matched than were returned.
  truncated: z.object({
    journals: z.boolean(),
    drafts: z.boolean(),
    accounts: z.boolean(),
  }),
});
export type SearchResults = z.infer<typeof searchResultsSchema>;

/** How many of each kind a search returns. */
export const SEARCH_LIMIT = 100;

export const searchContract = c.router({
  search: c.query({
    method: "GET",
    path: "/search",
    summary:
      "Journals, drafts and accounts matching every word of q, as the table searches match",
    query: z.object({ q: z.string().default("") }),
    responses: {
      200: searchResultsSchema,
      403: errorBodySchema,
    },
  }),
});

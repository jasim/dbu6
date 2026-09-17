import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { categorizationReportSchema } from "./import-drafts.js";

const c = initContract();

const errorSchema = z
  .object({
    error: z.string(),
    message: z.string().optional(),
    detail: z.string().optional(),
    hint: z.string().optional(),
    code: z.string().optional(),
    uncategorized_count: z.number().optional(),
    failing_count: z.number().optional(),
    duplicate_count: z.number().optional(),
  })
  .passthrough();

const classifiedDraftTransactionSchema = z.object({
  id: z.number(),
  narration: z.string(),
  account_id: z.number().nullable(),
  account_name: z.string().nullable(),
});

// Classifying drafts again: each draft's narration and account, and how the
// LLM fared on what the mapping rules didn't categorize.
export const draftClassificationSchema = z.object({
  transactions: z.array(classifiedDraftTransactionSchema),
  categorization: categorizationReportSchema,
});
export type DraftClassification = z.infer<typeof draftClassificationSchema>;

export const gpayDraftClassificationSchema = draftClassificationSchema.extend({
  gpay_enriched_count: z.number(),
});
export type GPayDraftClassification = z.infer<
  typeof gpayDraftClassificationSchema
>;

const repeatedFormStringSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]));

const repeatedFormIdSchema = z.preprocess(
  (value) => (Array.isArray(value) ? value : [value]),
  z.array(z.coerce.number().int().positive()).min(1),
);

export const draftTransactionsContract = c.router({
  classifyDraftTransactions: c.mutation({
    method: "POST",
    path: "/draft-transactions/classify",
    summary: "Classify selected draft transactions",
    body: z.object({
      ids: z.array(z.number().int()).min(1),
      custom_mappings_filenames: z.array(z.string()).optional(),
    }),
    responses: {
      200: draftClassificationSchema,
      400: errorSchema,
      403: errorSchema,
    },
  }),
  classifyDraftTransactionsWithGPay: c.mutation({
    method: "POST",
    path: "/draft-transactions/classify-with-gpay",
    summary: "Enrich selected drafts from GPay HTML, then classify them",
    contentType: "multipart/form-data",
    body: z.object({
      ids: repeatedFormIdSchema,
      custom_mappings_filenames: repeatedFormStringSchema
        .optional()
        .default([]),
    }),
    responses: {
      200: gpayDraftClassificationSchema,
      400: errorSchema,
      403: errorSchema,
    },
  }),
  renderDraftHledger: c.query({
    method: "GET",
    path: "/draft-transactions/hledger",
    summary: "Render draft transactions as hledger journal text",
    query: z.object({
      base_account_id: z.coerce.number().int().positive(),
    }),
    responses: {
      200: z.object({
        hledger_journal: z.string(),
        transaction_count: z.number(),
        base_account: z.string(),
      }),
      403: errorSchema,
      404: errorSchema,
    },
  }),
  postDraftsToJournal: c.mutation({
    method: "POST",
    path: "/draft-transactions/post-to-journal",
    summary: "Post draft transactions for a base account",
    body: z.object({
      base_account_id: z.number().int().positive(),
    }),
    responses: {
      200: z.object({
        base_account: z.string(),
        journals_created: z.number(),
        entries_created: z.number(),
        drafts_posted: z.number(),
      }),
      403: errorSchema,
      404: errorSchema,
      422: errorSchema,
    },
  }),
});

import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

const c = initContract();

export const sameAccountSkipSchema = z.object({
  date: z.string(),
  narration: z.string(),
  account: z.string(),
});

export const importSummarySchema = z.object({
  hledger_journal: z.string(),
  transaction_count: z.number(),
  skipped_reconciled_count: z.number(),
  draft_transaction_count: z.number(),
  duplicate_count: z.number(),
  draft_duplicate_count: z.number().default(0),
  journal_duplicate_count: z.number().default(0),
  legacy_match_count: z.number().default(0),
  backfilled_count: z.number(),
  same_account_skips: z.array(sameAccountSkipSchema),
  gpay_enriched_count: z.number().default(0),
});

export const balanceSourceSchema = z.enum([
  "manual",
  "statement",
  "checkpoint",
  "per-row",
  "none",
]);

export const resolvedBalanceMetadataSchema = z.object({
  extracted: z.number().nullable(),
  effective: z.number().nullable(),
  source: balanceSourceSchema,
});

export const freeformImportResultSchema = importSummarySchema.extend({
  opening_balance: z.number().nullable(),
  closing_balance_from_statement: z.number().nullable(),
  custom_statement_parser_paths: z.array(z.string()).optional(),
  balance_metadata: z.object({
    opening: resolvedBalanceMetadataSchema,
    closing: resolvedBalanceMetadataSchema,
  }),
  warnings: z.array(z.string()),
});

export const importErrorSchema = z
  .object({
    error: z.string(),
    message: z.string().optional(),
    detail: z.string().optional(),
    hint: z.string().optional(),
  })
  .passthrough();

export const importDraftsContract = c.router({
  uploadStatementBatch: c.mutation({
    method: "POST",
    path: "/import-draft/statement/upload",
    summary:
      "Upload statement files (optionally with a Google Pay Takeout HTML as `gpay` to enrich UPI narrations) and import draft transactions",
    contentType: "multipart/form-data",
    body: z.any(),
    responses: {
      200: freeformImportResultSchema,
      400: importErrorSchema,
      403: importErrorSchema,
      422: importErrorSchema,
      502: importErrorSchema,
    },
  }),
});

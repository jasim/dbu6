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

// One uploaded file as the automatic import sees it: recognised by exactly one
// saved parser (and therefore tied to one account), or not. Rejections carry
// the same per-file rows so the UI can annotate the list the user dropped.
export const autoImportFileSchema = z.object({
  file_name: z.string(),
  status: z.enum(["matched", "unrecognized", "ambiguous"]),
  parser_path: z.string().optional(),
  account: z.string().optional(),
  preset_name: z.string().optional(),
  candidate_parser_paths: z.array(z.string()).optional(),
  matching_parser_paths: z.array(z.string()).optional(),
});

// What the automatic import decided before touching the ledger: the single
// account every file resolved to and how each file will be read.
export const importPlanSchema = z.object({
  account: z.string(),
  account_kind: z.enum(["bank", "credit-card"]),
  files: z.array(autoImportFileSchema),
});

export const autoImportResultSchema = freeformImportResultSchema.extend({
  plan: importPlanSchema,
});

export const autoImportErrorSchema = importErrorSchema.extend({
  files: z.array(autoImportFileSchema).optional(),
});

export const importDraftsContract = c.router({
  uploadStatementsAuto: c.mutation({
    method: "POST",
    path: "/import-draft/statements/auto",
    summary:
      "Upload statement files with no other input; each file is recognised by a saved parser, all files must resolve to one account, and drafts are imported through the universal statement pipeline",
    contentType: "multipart/form-data",
    body: z.any(),
    responses: {
      200: autoImportResultSchema,
      400: autoImportErrorSchema,
      403: autoImportErrorSchema,
      422: autoImportErrorSchema,
      501: autoImportErrorSchema,
      502: autoImportErrorSchema,
    },
  }),
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

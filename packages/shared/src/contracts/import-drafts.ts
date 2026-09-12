import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { abacusImportRequestSchema } from "./abacus.js";
import { statementAccountSchema } from "./statement-account.js";

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

// The first and last transaction dates of the assembled statement, before
// the reconciliation filter trims what the ledger already holds. Null when
// the statement has no rows.
export const statementPeriodSchema = z.object({
  first_date: z.string(),
  last_date: z.string(),
});

// The ledger's last reconciled balance for the account, the point from which
// rows count as new. Null when the account has never been reconciled.
export const reconciliationCheckpointSchema = z.object({
  date: z.string(),
  balance: z.number(),
});

export const statementImportResultSchema = importSummarySchema.extend({
  opening_balance: z.number().nullable(),
  closing_balance_from_statement: z.number().nullable(),
  custom_statement_parser_paths: z.array(z.string()).optional(),
  balance_metadata: z.object({
    opening: resolvedBalanceMetadataSchema,
    closing: resolvedBalanceMetadataSchema,
  }),
  statement_period: statementPeriodSchema.nullable(),
  reconciliation_checkpoint: reconciliationCheckpointSchema.nullable(),
});

export const importErrorSchema = z
  .object({
    error: z.string(),
    message: z.string().optional(),
    detail: z.string().optional(),
    hint: z.string().optional(),
  })
  .passthrough();

// One uploaded file as the automatic import sees it. Recognition runs every
// saved parser whose extensions fit the file, then the parser and the account
// identifier the statement reports pick the preset. Each outcome carries only
// what explains it, so a rejection annotates the list the user dropped.
const reportedStatementFields = {
  file_name: z.string(),
  parser_path: z.string(),
  // What the statement prints about itself; null when the parser emits none.
  account: statementAccountSchema.nullable(),
  // The institution name as printed. Reported only; never used to match.
  institution: z.string().nullable(),
};

export const autoImportPlanFileSchema = z.discriminatedUnion("status", [
  z.object({
    ...reportedStatementFields,
    status: z.literal("resolved"),
    preset_name: z.string(),
  }),
  z.object({
    file_name: z.string(),
    status: z.literal("unrecognized"),
    candidate_parser_paths: z.array(z.string()),
  }),
  z.object({
    file_name: z.string(),
    status: z.literal("ambiguous"),
    matching_parser_paths: z.array(z.string()),
  }),
  z.object({
    ...reportedStatementFields,
    status: z.literal("unresolved"),
    reason: z.enum([
      "no_preset_for_parser",
      "statement_account_identifier_required",
      "statement_account_identifier_mismatch",
    ]),
    message: z.string(),
    candidate_preset_names: z.array(z.string()),
  }),
]);

// One preset's share of the batch: one preset is one account, so this is one
// run of the normal statement import over the files that resolved to it.
export const autoImportGroupResultSchema = z.object({
  preset_name: z.string(),
  base_account: z.string(),
  is_credit_card: z.boolean(),
  file_names: z.array(z.string()),
  result: statementImportResultSchema,
});

// A freeform import names its account directly, not through a preset, so its
// result is a group without a preset name.
export const abacusImportResultSchema = autoImportGroupResultSchema.omit({
  preset_name: true,
});

// Every file's outcome, plus the import each preset group produced. The plan
// is reported whether or not anything was imported.
export const autoImportResultSchema = z.object({
  files: z.array(autoImportPlanFileSchema),
  groups: z.array(autoImportGroupResultSchema),
});

export type AutoImportPlanFile = z.infer<typeof autoImportPlanFileSchema>;
export type AutoImportGroupResult = z.infer<typeof autoImportGroupResultSchema>;
export type AbacusImportResult = z.infer<typeof abacusImportResultSchema>;
export type AutoImportResult = z.infer<typeof autoImportResultSchema>;
export type AutoImportFailedGroup = z.infer<typeof autoImportFailedGroupSchema>;
export type StatementImportResultBody = z.infer<
  typeof statementImportResultSchema
>;

// The account whose import raised the error, with the files that went into
// it. Absent when the batch was rejected before any import ran.
export const autoImportFailedGroupSchema = z.object({
  preset_name: z.string(),
  base_account: z.string(),
  is_credit_card: z.boolean(),
  file_names: z.array(z.string()),
});

export const autoImportErrorSchema = importErrorSchema.extend({
  files: z.array(autoImportPlanFileSchema).optional(),
  failed_group: autoImportFailedGroupSchema.optional(),
  // Groups whose drafts were already saved when a later group failed. Their
  // files must be removed from the batch before it is retried.
  imported_groups: z.array(autoImportGroupResultSchema).optional(),
  partial_import: z.string().optional(),
});

export const importDraftsContract = c.router({
  uploadStatementsAuto: c.mutation({
    method: "POST",
    path: "/import-draft/statements/auto",
    summary:
      "Upload statement files as `files`, and optionally a Google Pay Takeout HTML as `gpay` to name UPI recipients; each file is recognised by a saved parser, its import preset is resolved from that parser and the account the statement reports, and one statement import runs per preset",
    contentType: "multipart/form-data",
    body: z.any(),
    responses: {
      200: autoImportResultSchema,
      400: autoImportErrorSchema,
      403: autoImportErrorSchema,
      422: autoImportErrorSchema,
    },
  }),
  importAbacusStatement: c.mutation({
    method: "POST",
    path: "/import-draft/abacus",
    summary:
      "Import one Abacus JSON statement, with its opening and closing balances, into drafts for the named ledger account. Coding agents post freeform transactions here; see custom-built-parsers/freeform-transactions-guide.md",
    body: abacusImportRequestSchema,
    responses: {
      200: abacusImportResultSchema,
      400: importErrorSchema,
      403: importErrorSchema,
      422: importErrorSchema,
    },
  }),
});

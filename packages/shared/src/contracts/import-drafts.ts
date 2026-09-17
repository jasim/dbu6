import { z } from "zod";
import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "@sapporta/shared/contracts";
import { abacusImportRequestSchema } from "./abacus.js";
import { CODING_AGENT_LABEL, codingAgentSchema } from "./coding-agent.js";
import { dateSpanSchema } from "./date-span.js";
import { datedBalanceSchema } from "./dated-balance.js";
import { statementImportErrorSchema } from "./import-errors.js";
import { statementAccountSchema } from "./statement-account.js";

const c = initContract();

export const sameAccountSkipSchema = z.object({
  date: z.string(),
  narration: z.string(),
  account: z.string(),
});

// Where categorization's LLM runs: the coding agent dbu6 uses on the server's
// machine, or the deprecated Nuabase gateway (LLM_ENGINE=nuabase).
export const categorizationEngineSchema = z.enum([
  "nuabase",
  ...codingAgentSchema.options,
]);
export type CategorizationEngine = z.infer<typeof categorizationEngineSchema>;

export const CATEGORIZATION_ENGINE_LABEL = {
  nuabase: "Nuabase",
  ...CODING_AGENT_LABEL,
} as const satisfies Record<CategorizationEngine, string>;

// How the LLM fared on the descriptions the mapping rules didn't categorize.
// A description is a distinct narration with its direction, sent once however
// many transactions share it. When the rules map everything, or there is
// nothing new, `sent_count` is 0.
export const categorizationReportSchema = z.object({
  // Null when no coding agent is installed.
  engine: categorizationEngineSchema.nullable(),
  // Distinct descriptions that needed the LLM.
  sent_count: z.number(),
  // Of those, how many got no answer because a call failed or couldn't run.
  failed_count: z.number(),
  // The first failure's message.
  error: z.string().nullable(),
});
export type CategorizationReport = z.infer<typeof categorizationReportSchema>;

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
  categorization: categorizationReportSchema,
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

export const statementImportResultSchema = importSummarySchema.extend({
  opening_balance: z.number().nullable(),
  closing_balance_from_statement: z.number().nullable(),
  custom_statement_parser_paths: z.array(z.string()).optional(),
  balance_metadata: z.object({
    opening: resolvedBalanceMetadataSchema,
    closing: resolvedBalanceMetadataSchema,
  }),
  // The first and last transaction dates of the assembled statement, before
  // the reconciliation filter trims what the ledger already holds. Null when
  // the statement has no rows.
  statement_period: dateSpanSchema.nullable(),
  // The ledger's last reconciled balance for the account, the point from
  // which rows count as new. Null when the account has never been reconciled.
  reconciliation_checkpoint: datedBalanceSchema.nullable(),
});

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

// The account whose import raised the error, with the files that went into
// it.
export const autoImportFailedGroupSchema = z.object({
  preset_name: z.string(),
  base_account: z.string(),
  is_credit_card: z.boolean(),
  file_names: z.array(z.string()),
});

// Why the automatic import refused a batch, one variant per way it can stop.
// An account's import raising a statement import error carries every file's
// outcome and the account that failed; accounts imported before it are saved
// (`imported_groups`), and their files must leave the batch before a retry.
export const autoImportErrorSchema = z.union([
  z.intersection(
    statementImportErrorSchema,
    z.object({
      files: z.array(autoImportPlanFileSchema),
      failed_group: autoImportFailedGroupSchema,
      imported_groups: z.array(autoImportGroupResultSchema).optional(),
      partial_import: z.string().optional(),
    }),
  ),
  // Nothing was imported: some file couldn't be tied to an import preset.
  z.object({
    error: z.literal("auto_import_files_unresolved"),
    message: z.string(),
    hint: z.string(),
    files: z.array(autoImportPlanFileSchema),
  }),
  z.object({
    error: z.literal("missing_multipart_field"),
    message: z.string(),
  }),
]);

// A freeform import refuses with a statement import error, or because the
// request names an account the ledger doesn't have.
export const abacusImportErrorSchema = z.discriminatedUnion("error", [
  ...statementImportErrorSchema.options,
  z.object({
    error: z.literal("import_account_not_found"),
    message: z.string(),
    hint: z.string(),
  }),
]);

export type AutoImportPlanFile = z.infer<typeof autoImportPlanFileSchema>;
export type AutoImportGroupResult = z.infer<typeof autoImportGroupResultSchema>;
export type AbacusImportResult = z.infer<typeof abacusImportResultSchema>;
export type AutoImportResult = z.infer<typeof autoImportResultSchema>;
export type AutoImportFailedGroup = z.infer<typeof autoImportFailedGroupSchema>;
export type AutoImportErrorBody = z.infer<typeof autoImportErrorSchema>;
export type AbacusImportErrorBody = z.infer<typeof abacusImportErrorSchema>;
export type StatementImportResultBody = z.infer<
  typeof statementImportResultSchema
>;

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
      403: errorBodySchema,
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
      400: abacusImportErrorSchema,
      403: errorBodySchema,
      422: abacusImportErrorSchema,
    },
  }),
});

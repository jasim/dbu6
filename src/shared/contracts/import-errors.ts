import { z } from "zod";

/*
 * The body of a refused statement import, one variant per `error` code. The
 * API builds these from its errors in one place (app/import-error-response.ts);
 * the Import screen and coding agents read them. Each code's fields are named
 * once, here. `message` is the server's own explanation; `hint`, where a code
 * has one, is advice in words.
 */

export const statementImportErrorSchema = z.discriminatedUnion("error", [
  // The import names an account the ledger doesn't have: a freeform request's
  // account, or a preset account whose ledger account was deleted.
  z.object({
    error: z.literal("import_account_not_found"),
    message: z.string(),
    hint: z.string(),
  }),
  // The statement doesn't line up with the ledger's last reconciled balance.
  z.object({
    error: z.literal("reconciliation_match_failed"),
    message: z.string(),
    checkpoint_date: z.string(),
    checkpoint_balance: z.number(),
  }),
  // The rows don't add up to the closing balance. `suspected_gap` when the
  // statement prints no running balances, so a missing period is the likely
  // cause (and `hint` says so); otherwise a row was probably misread.
  z.object({
    error: z.literal("balance_mismatch"),
    message: z.string(),
    computed_final: z.number(),
    statement_closing: z.number(),
    difference: z.number(),
    tolerance: z.number(),
    suspected_gap: z.boolean(),
    hint: z.string().optional(),
  }),
  // The activity between two printed running balances doesn't reconcile.
  z.object({
    error: z.literal("segment_balance_mismatch"),
    message: z.string(),
    from_date: z.string(),
    to_date: z.string(),
    from_balance: z.number(),
    walked: z.number(),
    printed: z.number(),
    difference: z.number(),
    tolerance: z.number(),
  }),
  z.object({
    error: z.literal("opening_balance_unavailable"),
    message: z.string(),
  }),
  z.object({
    error: z.literal("closing_balance_unavailable"),
    message: z.string(),
  }),
  // Two uploaded parts don't meet. `same-statement-twice` when the later one
  // covers the same dates and balances as the earlier (and `hint` says so);
  // `gap` when activity between them is missing from both.
  z.object({
    error: z.literal("statement_boundary_mismatch"),
    message: z.string(),
    reason: z.enum(["gap", "same-statement-twice"]),
    earlier_source: z.string(),
    later_source: z.string(),
    earlier_closing: z.number(),
    later_opening: z.number(),
    difference: z.number(),
    hint: z.string().optional(),
  }),
  // Two parts cover one day and print it differently.
  z.object({
    error: z.literal("statement_disagreement"),
    message: z.string(),
    parts: z.tuple([z.string(), z.string()]),
    date: z.string(),
    row: z.object({
      part: z.string(),
      narration: z.string(),
      withdrawal: z.number(),
      deposit: z.number(),
      balance: z.number().nullable(),
    }),
  }),
  // A part with no balance to place it among the others.
  z.object({
    error: z.literal("statement_part_unjoinable"),
    message: z.string(),
    part: z.string(),
  }),
  // A part that contradicts itself. `cause` is the body of the balance error
  // the check reused, when it reused one.
  z.object({
    error: z.literal("statement_part_invalid"),
    message: z.string(),
    part: z.string(),
    detail: z.string(),
    cause: z.looseObject({ error: z.string(), message: z.string() }).optional(),
  }),
  z.object({
    error: z.literal("ambiguous_duplicate"),
    message: z.string(),
    source_transaction_key: z.string().nullable(),
    candidate_ids: z.array(z.union([z.number(), z.string()])),
  }),
  z.object({
    error: z.literal("assertion_conflict"),
    message: z.string(),
    date: z.string(),
    existing_assertion: z.number(),
    expected_assertion: z.number(),
  }),
  z.object({
    error: z.literal("abacus_json_parse_failed"),
    message: z.string(),
    detail: z.string(),
  }),
  z.object({
    error: z.literal("categorization_config_error"),
    message: z.string(),
  }),
]);
export type StatementImportError = z.infer<typeof statementImportErrorSchema>;
export type StatementImportErrorCode = StatementImportError["error"];

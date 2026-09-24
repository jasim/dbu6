import { z } from "zod";
import { statementAccountSchema } from "./statement-account.js";

// The Abacus statement's wire contract: the JSON every statement source is
// reduced to before the import runs. Deterministic parsers under
// custom-built-parsers/ write it, and a coding agent posts it directly for
// freeform transactions. Balances are in ledger semantics: assets positive,
// liabilities (credit cards) negative.

export const withdrawalMoneySchema = z.object({
  withdrawal: z.number().positive(),
  deposit: z.literal(0),
});

export const depositMoneySchema = z.object({
  withdrawal: z.literal(0),
  deposit: z.number().positive(),
});

const abacusRowFields = {
  date: z.iso.date(),
  narration: z.string(),
  // Null when the statement didn't print a per-row running balance (typical
  // for credit-card statements). Downstream callers that need an assertion
  // treat null as "no assertion for this row".
  balance: z.number().nullable(),
  source_reference: z.string().trim().min(1).nullable().optional(),
  source_transaction_key: z.string().trim().min(1).nullable().optional(),
};

// One transaction row. Direction is a union so the generated JSON Schema
// carries the withdrawal/deposit XOR rule that runtime parsing enforces.
export const abacusRowSchema = z.union([
  withdrawalMoneySchema.extend(abacusRowFields),
  depositMoneySchema.extend(abacusRowFields),
]);

export const abacusJsonSchema = z.object({
  kind: z.literal("abacus"),
  opening: z.number().nullable().optional(),
  closing: z.number().nullable().optional(),
  // The account or card number the statement prints about itself, in the
  // canonical form defined by `statementAccountSchema`, so an import can be
  // matched to the right preset account. Omitted when nothing is printed.
  account: statementAccountSchema.nullable().optional(),
  // The bank or card issuer's name exactly as the statement prints it,
  // trimmed. Two statements from one institution may print it differently
  // (a shortened form, a division name), so this is lookup text for finding
  // an institution, never matched. Null or omitted when nothing is printed.
  institution: z.string().trim().min(1).nullable().optional(),
  rows: z.array(abacusRowSchema).min(1, "Transaction list is empty"),
});
export type AbacusJson = z.infer<typeof abacusJsonSchema>;

// An Abacus statement a coding agent assembled from freeform transactions,
// with the ledger account it goes into and whether that account is a credit
// card, as the user chose them. That is all the import needs; no import preset
// is involved. The user states both balances, so both are required and the
// rows are always checked against them.
export const abacusImportRequestSchema = z.object({
  base_account: z.string().min(1),
  is_credit_card: z.boolean(),
  // A short label for the result and for error messages.
  source_name: z.string().trim().min(1).optional(),
  statement: abacusJsonSchema.extend({
    opening: z.number(),
    closing: z.number(),
  }),
});
export type AbacusImportRequest = z.infer<typeof abacusImportRequestSchema>;

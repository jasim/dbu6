import { z } from "zod";
import {
  depositMoneySchema,
  withdrawalMoneySchema,
  type Money,
} from "./Money.js";

const abacusFields = {
  date: z.iso.date(),
  narration: z.string(),
  // Null when the statement didn't print a per-row running balance (typical
  // for credit-card statements). Downstream callers that need an assertion
  // treat null as "no assertion for this row".
  balance: z.number().nullable(),
  source_reference: z.string().trim().min(1).nullable().optional(),
  source_transaction_key: z.string().trim().min(1).nullable().optional(),
};

export const abacusSchema = z.union([
  withdrawalMoneySchema.extend(abacusFields),
  depositMoneySchema.extend(abacusFields),
]);

// Canonical wire contract for an uploaded or generated Abacus JSON document.
// LLM extraction derives its transaction-only output schema from this object,
// so the prompt and the upload parser cannot drift between `transactions` and
// `rows` again.
export const abacusJsonSchema = z.object({
  kind: z.literal("abacus"),
  opening: z.number().nullable().optional(),
  closing: z.number().nullable().optional(),
  rows: z.array(abacusSchema).min(1, "Transaction list is empty"),
});

export const abacusRowsJsonSchema = abacusJsonSchema.pick({
  kind: true,
  rows: true,
});

export type Abacus = Money & {
  date: string;
  narration: string;
  balance: number | null;
  source_reference?: string | null;
  source_transaction_key?: string | null;
};

export function validateTransactions(transactions: readonly Abacus[]): void {
  const result = abacusJsonSchema.shape.rows.safeParse(transactions);
  if (!result.success) {
    throw new Error(`Invalid Abacus transactions: ${result.error.message}`);
  }
}

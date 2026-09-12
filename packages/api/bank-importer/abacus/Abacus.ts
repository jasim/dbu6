// The Abacus statement: the one shape every statement source is reduced to
// before the shared balance-validation and draft-import tail runs.
//
// Deterministic parsers under custom-built-parsers/ write it as JSON. This
// module is the single home of its wire schema, its in-memory type, parsing,
// validation, and the transformations that keep it in ledger semantics.
import { z } from "zod";
import { statementAccountSchema, type StatementAccount } from "dbu6-shared";
import {
  depositMoneySchema,
  withdrawalMoneySchema,
  type Money,
} from "../domain/Money.js";
import type { Chrono } from "../domain/Chrono.js";
import { AbacusJsonParseError } from "../import-errors.js";
import { normalizeChronological } from "./balances.js";

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

// One transaction row. Direction is a union so the generated JSON Schema
// carries the withdrawal/deposit XOR rule that runtime parsing enforces.
export const abacusSchema = z.union([
  withdrawalMoneySchema.extend(abacusFields),
  depositMoneySchema.extend(abacusFields),
]);

export type Abacus = Money & {
  date: string;
  narration: string;
  balance: number | null;
  source_reference?: string | null;
  source_transaction_key?: string | null;
};

// Canonical wire contract for an Abacus JSON document.
export const abacusJsonSchema = z.object({
  kind: z.literal("abacus"),
  opening: z.number().nullable().optional(),
  closing: z.number().nullable().optional(),
  // The account or card number the statement prints about itself, in the
  // canonical form defined by `statementAccountSchema`. Deterministic parsers
  // emit it so an import can be matched to the right preset; hand-written
  // JSON may leave it out.
  account: statementAccountSchema.nullable().optional(),
  // The bank or card issuer's name exactly as the statement prints it,
  // trimmed. Two statements from one institution may print it differently
  // (a shortened form, a division name), so this is lookup text for finding
  // a preset, not an identifier. Null or omitted when nothing is printed.
  institution: z.string().trim().min(1).nullable().optional(),
  rows: z.array(abacusSchema).min(1, "Transaction list is empty"),
});

// The parsed document: rows in chronological order plus everything the
// statement said about itself. Balances are in ledger semantics (liabilities
// negative), which is also what the JSON contract carries.
export interface AbacusStatement {
  transactions: Chrono<Abacus>;
  opening: number | null;
  closing: number | null;
  // The account or card number printed on the statement, when the source
  // reported one; null when it reported none.
  account: StatementAccount | null;
  // The institution's name as printed on the statement; lookup text, not an
  // identifier. Null when the statement prints none.
  institution: string | null;
}

export function validateTransactions(transactions: readonly Abacus[]): void {
  const result = abacusJsonSchema.shape.rows.safeParse(transactions);
  if (!result.success) {
    throw new Error(`Invalid Abacus transactions: ${result.error.message}`);
  }
}

// Text of an Abacus JSON document -> AbacusStatement. Rows are normalized
// to chronological order; a descending document is reversed so same-day
// rows keep their relative order.
export function parseAbacusJson(
  text: string,
  logPrefix: string,
): AbacusStatement {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AbacusJsonParseError(`invalid JSON: ${message}`);
  }

  const result = abacusJsonSchema.safeParse(raw);
  if (!result.success) {
    throw new AbacusJsonParseError(
      `schema validation failed: ${result.error.message}`,
    );
  }

  const parsed = result.data;
  const statement: AbacusStatement = {
    transactions: normalizeChronological(parsed.rows),
    opening: parsed.opening ?? null,
    closing: parsed.closing ?? null,
    account: parsed.account ?? null,
    institution: parsed.institution ?? null,
  };
  console.log(
    `[${logPrefix}] parsed abacus json: ${parsed.rows.length} row(s), ${describeStatement(statement)}`,
  );
  return statement;
}

export function describeStatement(statement: AbacusStatement): string {
  const account =
    statement.account === null
      ? "none"
      : `${statement.account.kind}:${statement.account.identifier}`;
  const institution =
    statement.institution === null
      ? "none"
      : JSON.stringify(statement.institution);
  return `opening=${statement.opening}, closing=${statement.closing}, account=${account}, institution=${institution}`;
}

// Credit-card statements print magnitudes with an implied
// debit-is-positive convention, but the ledger represents liabilities as
// negative. Flip the signs on the balances (opening, closing, per-row)
// but leave `withdrawal`/`deposit` alone — direction is already classified.
// Non-CC passthrough.
export function applyCreditCardSignFlip(
  statement: AbacusStatement,
  isCreditCard: boolean,
): AbacusStatement {
  if (!isCreditCard) return statement;
  const flipped = statement.transactions.map((t) => ({
    ...t,
    balance: t.balance === null ? null : -t.balance,
  }));
  return {
    ...statement,
    transactions: flipped as unknown as Chrono<Abacus>,
    opening: statement.opening === null ? null : -statement.opening,
    closing: statement.closing === null ? null : -statement.closing,
  };
}

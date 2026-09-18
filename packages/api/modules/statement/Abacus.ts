// The Abacus statement: the one shape every statement source is reduced to
// before the shared balance-validation and draft-import tail runs.
//
// Deterministic parsers under custom-built-parsers/ write it as JSON, and a
// coding agent posts it as JSON for freeform transactions. Its wire schema
// lives in dbu6-shared (`abacusJsonSchema`); this module is the home of its
// in-memory type, parsing, validation, and the transformations that keep it
// in ledger semantics.
//
// Every statement is built by `abacusStatementFromJson` from a document the
// wire schema accepted, and `Abacus` is that schema's row, so the rows need
// no checking again downstream.
import {
  abacusJsonSchema,
  type AbacusJson,
  type StatementAccount,
} from "dbu6-shared";
import type { Money, Chrono } from "../values/index.js";
import { AbacusJsonParseError } from "./import-errors.js";
import { normalizeChronological } from "./balances.js";

// One statement row. Its money moves one way (`Money`), as the schema says.
export type Abacus = Money & {
  date: string;
  narration: string;
  balance: number | null;
  source_reference?: string | null;
  source_transaction_key?: string | null;
};

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

// A statement that states both of its balances, as a freeform import must.
// `verifyDeclaredBalances` checks its rows against both.
export type BalancedStatement = AbacusStatement & {
  opening: number;
  closing: number;
};

// Text of an Abacus JSON document -> AbacusStatement.
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

  const statement = abacusStatementFromJson(result.data);
  console.log(
    `[${logPrefix}] parsed abacus json: ${result.data.rows.length} row(s), ${describeStatement(statement)}`,
  );
  return statement;
}

// A validated Abacus JSON document -> AbacusStatement. Rows are normalized to
// chronological order; a descending document is reversed so same-day rows
// keep their relative order. Rows that run in both directions cannot be
// ordered and are rejected as a malformed document. A document that states
// both balances makes a `BalancedStatement`.
export function abacusStatementFromJson(
  document: AbacusJson & { opening: number; closing: number },
): BalancedStatement;
export function abacusStatementFromJson(document: AbacusJson): AbacusStatement;
export function abacusStatementFromJson(document: AbacusJson): AbacusStatement {
  let transactions: Chrono<Abacus>;
  try {
    transactions = normalizeChronological(document.rows);
  } catch (err) {
    throw new AbacusJsonParseError(
      err instanceof Error ? err.message : String(err),
    );
  }
  return {
    transactions,
    opening: document.opening ?? null,
    closing: document.closing ?? null,
    account: document.account ?? null,
    institution: document.institution ?? null,
  };
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

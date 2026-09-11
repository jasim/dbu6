import { abacusJsonSchema as canonicalAbacusJsonSchema } from "../domain/Abacus.js";
import { normalizeChronological } from "../balance-math.js";
import { AbacusJsonParseError } from "../import-errors.js";
import type { StatementData } from "./freeform-text.js";

// Preserve this parser-level export for callers while keeping the schema's
// single source of truth in the Abacus domain module.
export const abacusJsonSchema = canonicalAbacusJsonSchema;

export function parseAbacusJson(
  text: string,
  logPrefix: string,
): StatementData {
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
  const opening = parsed.opening ?? null;
  const closing = parsed.closing ?? null;
  const account = parsed.account ?? null;
  const transactions = normalizeChronological(parsed.rows);
  console.log(
    `[${logPrefix}] parsed abacus json: ${parsed.rows.length} row(s), opening=${opening}, closing=${closing}, account=${
      account === null ? "none" : `${account.kind}:${account.identifier}`
    }`,
  );
  return {
    transactions,
    opening,
    closing,
    account,
  };
}

import { z } from "zod";
import type { Abacus } from "../domain/Abacus.js";
import { isWithdrawal } from "../domain/Money.js";

const accountSchema = z.string().trim().min(1);
const directionSchema = z.enum(["withdrawal", "deposit"]);

/**
 * Shape of the `mappings` export in the user's `transaction_mappings.mjs`.
 * User-authored, so it is parsed rather than trusted.
 */
export const mappingRulesSchema = z.object({
  exact: z.record(z.string(), accountSchema),
  includes: z.array(
    z.object({
      account: accountSchema,
      direction: directionSchema.optional(),
      values: z.array(accountSchema).min(1),
    }),
  ),
});

export type MappingRules = z.infer<typeof mappingRulesSchema>;
type Direction = z.infer<typeof directionSchema>;

interface CompiledInclude {
  account: string;
  direction?: Direction;
  value: string;
}

export interface CompiledMappings {
  exact: Map<string, string>;
  includes: CompiledInclude[];
}

/** Fold away the casing and spacing noise banks add to narrations. */
export function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
}

export function compileMappings(rules: MappingRules): CompiledMappings {
  const exact = new Map<string, string>();
  for (const [narration, account] of Object.entries(rules.exact)) {
    const key = normalize(narration);
    const existing = exact.get(key);
    if (existing && existing !== account) {
      throw new Error(
        `Conflicting exact transaction mapping for ${JSON.stringify(narration)}: ` +
          `${existing} and ${account}`,
      );
    }
    exact.set(key, account);
  }

  // Flatten to one entry per value so lookup is a single ordered scan.
  const includes = rules.includes.flatMap((rule) =>
    rule.values.map((value) => ({
      account: rule.account,
      direction: rule.direction,
      value: normalize(value),
    })),
  );

  return { exact, includes };
}

/**
 * Exact mappings always win. Includes are checked in declaration order, so
 * narrower patterns must be declared ahead of broader category patterns.
 */
export function classifyWith(
  compiled: CompiledMappings,
  transaction: Abacus,
): string | null {
  const narration = normalize(transaction.narration);

  const exactAccount = compiled.exact.get(narration);
  if (exactAccount) return exactAccount;

  const direction: Direction = isWithdrawal(transaction)
    ? "withdrawal"
    : "deposit";
  for (const mapping of compiled.includes) {
    if (mapping.direction && mapping.direction !== direction) continue;
    if (narration.includes(mapping.value)) return mapping.account;
  }

  return null;
}

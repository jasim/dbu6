import { z } from "zod";
import type { Abacus } from "../statement/index.js";
import { isWithdrawal } from "../values/index.js";

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
  // The subset of `exact` whose keys are UPI VPAs (`payee@psp`). Banks bury
  // the VPA inside a delimited narration (`UPIOUT/<ref>/<vpa>/...`,
  // `UPI-<name>-<vpa>-<ifsc>-...`), so these are also matched against the VPA
  // embedded in a narration, not only against the whole narration.
  vpa: Map<string, string>;
  includes: CompiledInclude[];
}

/** Fold away the casing and spacing noise banks add to narrations. */
export function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
}

// A VPA embedded in a narration is bounded by the bank's delimiters (`/`,
// `-`, spaces) or the ends of the text. Letters, digits, and dots continue a
// VPA, so `x@psp` must not match inside `ax@psp` or `x@psp.example`.
const VPA_CHAR = /[A-Z0-9.]/;

export function isVpa(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value);
}

function containsVpa(narration: string, vpa: string): boolean {
  let from = 0;
  for (;;) {
    const at = narration.indexOf(vpa, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : narration[at - 1];
    const after = narration[at + vpa.length] ?? "";
    if (!VPA_CHAR.test(before) && !VPA_CHAR.test(after)) return true;
    from = at + 1;
  }
}

export function compileMappings(rules: MappingRules): CompiledMappings {
  const exact = new Map<string, string>();
  const vpa = new Map<string, string>();
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
    if (isVpa(key)) vpa.set(key, account);
  }

  // Flatten to one entry per value so lookup is a single ordered scan.
  const includes = rules.includes.flatMap((rule) =>
    rule.values.map((value) => ({
      account: rule.account,
      direction: rule.direction,
      value: normalize(value),
    })),
  );

  return { exact, vpa, includes };
}

/**
 * Exact mappings always win: first against the whole narration, then a VPA
 * key against the VPA embedded in the narration. Includes are checked in
 * declaration order, so narrower patterns must be declared ahead of broader
 * category patterns.
 */
export function classifyWith(
  compiled: CompiledMappings,
  transaction: Abacus,
): string | null {
  const narration = normalize(transaction.narration);

  const exactAccount = compiled.exact.get(narration);
  if (exactAccount) return exactAccount;

  for (const [vpa, account] of compiled.vpa) {
    if (containsVpa(narration, vpa)) return account;
  }

  const direction: Direction = isWithdrawal(transaction)
    ? "withdrawal"
    : "deposit";
  for (const mapping of compiled.includes) {
    if (mapping.direction && mapping.direction !== direction) continue;
    if (narration.includes(mapping.value)) return mapping.account;
  }

  return null;
}

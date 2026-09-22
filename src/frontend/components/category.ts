/*
 * The colour of an account as the everyday screens show it, beside its name.
 * An account takes its own hue when its name asks for one, else its parent's
 * colour through the account tree (`parent_id`), else grey. The name only
 * labels the account; the tree decides who inherits.
 */

/** The hue keys frontend.css defines as `--cat-<key>` (PLAN.md §4.3). */
export const CATEGORY_HUE_KEYS = [
  "taxes",
  "home",
  "food",
  "family",
  "children",
  "transport",
  "insurance",
  "travel",
  "shopping",
  "health",
  "utilities",
  "personal",
  "subscriptions",
  "fees",
  "fun",
  "giving",
  "learning",
  "other",
] as const;

export type CategoryHueKey = (typeof CATEGORY_HUE_KEYS)[number];

/** Seeded dbu6 group names whose hue is filed under the design's key. */
const GROUP_HUE_ALIASES: Record<string, CategoryHueKey> = {
  housing: "home",
  entertainment: "fun",
  education: "learning",
  finance: "fees",
};

/**
 * The hue an account's own name asks for, in any case: a hue key, or a
 * seeded group name filed under one. `other` is the fallback, so an account
 * named "Other" asks for nothing and inherits.
 */
export function ownHue(name: string): CategoryHueKey | null {
  const key = name.trim().toLowerCase();
  if (key === "other") return null;
  const aliased = GROUP_HUE_ALIASES[key];
  if (aliased) return aliased;
  return (CATEGORY_HUE_KEYS as readonly string[]).includes(key)
    ? (key as CategoryHueKey)
    : null;
}

/**
 * An account's hue: its own, else `parentHue`, the colour of its parent in
 * the account tree (grey for a top account).
 */
export function accountHue(
  name: string,
  parentHue: CategoryHueKey = "other",
): CategoryHueKey {
  return ownHue(name) ?? parentHue;
}

/** The CSS colour for a hue key, as frontend.css defines it. */
export function categoryHueColor(key: CategoryHueKey): string {
  return `var(--cat-${key})`;
}

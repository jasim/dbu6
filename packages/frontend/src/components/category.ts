/*
 * The colour of an account as the everyday screens show it, beside its
 * friendly name (`accountPathName` in dbu6-shared). An account takes its own
 * hue when its name asks for one, else its parent's colour through the
 * account tree (`parent_id`), else grey. The name only labels the account;
 * the tree decides who inherits. The colon path itself belongs only in
 * tooltips, aria labels and the All tools screens.
 */

/** The hue keys app.css defines as `--cat-<key>` (PLAN.md §4.3). */
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
  child: "children",
  entertainment: "fun",
  education: "learning",
  finance: "fees",
};

/**
 * The hue an account's own name asks for: the last segment of its path, when
 * that is a hue key or a seeded group name filed under one. `other` is the
 * fallback, so an account named "other" asks for nothing and inherits.
 */
export function ownHue(path: string): CategoryHueKey | null {
  const last = path
    .split(":")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "")
    .at(-1);
  if (last === undefined || last === "other") return null;
  const aliased = GROUP_HUE_ALIASES[last];
  if (aliased) return aliased;
  return (CATEGORY_HUE_KEYS as readonly string[]).includes(last)
    ? (last as CategoryHueKey)
    : null;
}

/**
 * An account's hue: its own, else `parentHue`, the colour of its parent in
 * the account tree (grey for a top account).
 */
export function accountHue(
  path: string,
  parentHue: CategoryHueKey = "other",
): CategoryHueKey {
  return ownHue(path) ?? parentHue;
}

/** The CSS colour for a hue key, as app.css defines it. */
export function categoryHueColor(key: CategoryHueKey): string {
  return `var(--cat-${key})`;
}

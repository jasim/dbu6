/*
 * The one place that turns an account path into what the everyday screens
 * show: a friendly name and the hue of its top-level group. The colon path
 * itself belongs only in tooltips, aria labels and the All tools screens.
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

/** Account types whose first segment is a bookkeeping prefix, not a group. */
const TYPE_PREFIXES = new Set([
  "expenses",
  "income",
  "assets",
  "liabilities",
  "equity",
  "revenue",
]);

function segments(path: string): string[] {
  return path
    .split(":")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * The top-level group of an account path: `expenses:food:food-delivery` is in
 * `food`. A path with only the type prefix, or nothing, has no group.
 */
export function categoryGroup(path: string): string | null {
  const parts = segments(path);
  const first = parts[0];
  if (first === undefined) return null;
  if (TYPE_PREFIXES.has(first)) return parts[1] ?? null;
  return first;
}

/** The hue key for a path's group, or `other` when the group has no hue. */
export function categoryHue(path: string): CategoryHueKey {
  const group = categoryGroup(path);
  if (group === null) return "other";
  const aliased = GROUP_HUE_ALIASES[group];
  if (aliased) return aliased;
  return (CATEGORY_HUE_KEYS as readonly string[]).includes(group)
    ? (group as CategoryHueKey)
    : "other";
}

/** The CSS colour for a hue key, as app.css defines it. */
export function categoryHueColor(key: CategoryHueKey): string {
  return `var(--cat-${key})`;
}

/**
 * The friendly name of an account: its last segment, with hyphens as spaces
 * and a capital first letter. `expenses:food:food-delivery` is "Food
 * delivery"; `expenses:food` is "Food".
 */
export function categoryName(path: string): string {
  const last = segments(path).at(-1);
  if (last === undefined) return "";
  const words = last.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

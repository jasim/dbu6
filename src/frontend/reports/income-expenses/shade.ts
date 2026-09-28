import type { Section } from "./figures";

/*
 * Colour for how much (PLAN.md §11 P4): each section's one hue, light for
 * the least and deep for the most, so the heavy months and the big accounts
 * stand out before anything is read. Spending runs warm, income green; the
 * steps are `--spend-*` and `--income-*` in frontend.css.
 */

/**
 * Where each value sits between the least and the most of them, from 0 to 1.
 * Values that barely differ stay close in shade: the spread counts as at
 * least a third of the largest. Nothing positive has no shade (null).
 */
export function shades(values: readonly number[]): (number | null)[] {
  const positive = values.filter((value) => value > 0);
  if (positive.length === 0) return values.map(() => null);
  const most = Math.max(...positive);
  const least = Math.min(...positive);
  const spread = Math.max(most - least, most / 3);
  return values.map((value) =>
    value > 0 ? Math.min(1, Math.max(0, 1 - (most - value) / spread)) : null,
  );
}

/** The section's colour at that shade. */
export function shadeColor(section: Section, shade: number): string {
  const [least, most] =
    section === "income"
      ? ["var(--income-least)", "var(--income-most)"]
      : ["var(--spend-least)", "var(--spend-most)"];
  return `color-mix(in oklch, ${most} ${Math.round(shade * 100)}%, ${least})`;
}

import type { NavigationItem as SapportaNavigationItem } from "@sapporta/frontend/shell";

/** A live count an item can show beside its label. */
export type NavigationBadge = "needsCategory";

export interface NavigationItem extends SapportaNavigationItem {
  badge?: NavigationBadge;
  /**
   * What the bottom bar prints when the label doesn't fit five across a
   * phone. The item's accessible name stays the full label.
   */
  shortLabel?: string;
}

/**
 * The everyday destinations, then the door to everything else. The sidebar
 * shows both groups with a rule between them; the bottom bar shows only the
 * first.
 */
export interface Navigation {
  everyday: readonly NavigationItem[];
  more: readonly NavigationItem[];
}

export type NavigationCounts = Partial<Record<NavigationBadge, number>>;

/** The count to show on an item, or nothing when there is none or it is zero. */
export function badgeCount(
  item: NavigationItem,
  counts: NavigationCounts,
): number | null {
  if (!item.badge) return null;
  const count = counts[item.badge];
  return count && count > 0 ? count : null;
}

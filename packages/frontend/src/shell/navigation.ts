import type {
  NavigationItem as SapportaNavigationItem,
  NavigationSection as SapportaNavigationSection,
} from "@sapporta/frontend/shell";

/** A live count an item can show beside its label. */
export type NavigationBadge = "needsCategory";

export interface NavigationItem extends SapportaNavigationItem {
  badge?: NavigationBadge;
}

export interface NavigationSection extends SapportaNavigationSection {
  items: readonly NavigationItem[];
}

export type Navigation = readonly NavigationSection[];

export type NavigationCounts = Partial<Record<NavigationBadge, number>>;

export function navigationItems(navigation: Navigation): NavigationItem[] {
  return navigation.flatMap((section) => section.items);
}

/** The count to show on an item, or nothing when there is none or it is zero. */
export function badgeCount(
  item: NavigationItem,
  counts: NavigationCounts,
): number | null {
  if (!item.badge) return null;
  const count = counts[item.badge];
  return count && count > 0 ? count : null;
}

import type { Location } from "react-router-dom";
import {
  isNavigationItemActive,
  type NavigationItem as SapportaNavigationItem,
} from "@sapporta/frontend/shell";

/** A live count an item can show beside its label. */
export type NavigationBadge = "waiting";

export interface NavigationItem extends SapportaNavigationItem {
  badge?: NavigationBadge;
  /**
   * What the bottom bar prints when the label doesn't fit five across a
   * phone. The item's accessible name stays the full label.
   */
  shortLabel?: string;
  /**
   * Other paths the item stays lit on, with what is under them: Update's
   * own steps, such as /import and /review.
   */
  matches?: readonly string[];
  /** Left off the phone's bottom bar, where five items fit. */
  sidebarOnly?: boolean;
}

/** A labelled group of the sidebar: "Your money", "Your books". */
export interface NavigationGroup {
  label: string;
  items: readonly NavigationItem[];
}

/**
 * The labelled groups, then the door to everything else. The sidebar shows
 * the groups under their labels and the rest after a rule; the bottom bar
 * shows the groups' items, but for those kept to the sidebar.
 */
export interface Navigation {
  groups: readonly NavigationGroup[];
  more: readonly NavigationItem[];
}

export type NavigationCounts = Partial<Record<NavigationBadge, number>>;

/** Every item, the groups' and the rest. */
export function navigationItems(navigation: Navigation): NavigationItem[] {
  return [
    ...navigation.groups.flatMap((group) => group.items),
    ...navigation.more,
  ];
}

/** The items on a phone's bottom bar. */
export function bottomBarItems(navigation: Navigation): NavigationItem[] {
  return navigation.groups
    .flatMap((group) => group.items)
    .filter((item) => !item.sidebarOnly);
}

/**
 * The one item lit for a location: of those whose path or `matches` hold
 * it, the most specific, so Income & expenses lights alone under /reports.
 * Null when none does.
 */
export function activeItem(
  items: readonly NavigationItem[],
  location: Location,
): NavigationItem | null {
  let best: { item: NavigationItem; length: number } | null = null;
  for (const item of items) {
    for (const to of [item.to, ...(item.matches ?? [])]) {
      if (!isNavigationItemActive({ ...item, to }, location)) {
        continue;
      }
      if (best === null || to.length > best.length) {
        best = { item, length: to.length };
      }
    }
  }
  return best?.item ?? null;
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

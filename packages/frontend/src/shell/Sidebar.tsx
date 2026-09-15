import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ListFilter } from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import {
  AuthAccountMenu,
  isNavigationItemActive,
  useSidebar,
} from "@sapporta/frontend/shell";
import { useAuthStore } from "@sapporta/frontend/auth";
import {
  badgeCount,
  navigationItems,
  type Navigation,
  type NavigationCounts,
  type NavigationItem,
} from "./navigation";

/*
 * dbu6's own sidebar, rail and bottom bar. They follow the redesign's
 * sidebar spec (PLAN.md §4.6) and reuse Sapporta only for behaviour: the
 * sidebar controller, the active-item rule and the account menu.
 */

interface NavigationProps {
  navigation: Navigation;
  counts: NavigationCounts;
}

/** The 34px green tile that stands for the app. */
export function Brand({ size = 34 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[10px] bg-primary font-bold text-primary-foreground"
      style={{ width: size, height: size, fontSize: size / 2 }}
    >
      d
    </span>
  );
}

const ITEM_BASE =
  "flex items-center no-underline transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40";
const ITEM_INACTIVE =
  "font-normal text-ink-soft hover:bg-card/70 hover:text-foreground";
const ITEM_ACTIVE = "bg-card font-semibold text-foreground shadow-pill";

function CountBadge({ count, compact }: { count: number; compact?: boolean }) {
  if (compact) {
    return (
      <span
        aria-hidden="true"
        className="absolute right-1.5 top-1.5 size-2 rounded-full bg-attention"
      />
    );
  }
  return (
    <span className="tnum shrink-0 rounded-full bg-attention px-2 py-0.5 font-mono text-[13px] font-medium text-primary-foreground">
      {count}
    </span>
  );
}

export function NavItem({
  item,
  active,
  count,
  compact = false,
  secondary = false,
}: {
  item: NavigationItem;
  active: boolean;
  count: number | null;
  /** Icon only, for the rail. */
  compact?: boolean;
  /** The smaller style of the group below the rule. */
  secondary?: boolean;
}) {
  const Icon = item.icon;
  const label = count === null ? item.label : `${item.label}, ${count}`;
  return (
    <Link
      to={item.to}
      title={compact ? label : undefined}
      aria-label={compact ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        ITEM_BASE,
        "rounded-control",
        compact
          ? "relative size-11 justify-center"
          : secondary
            ? "gap-2.5 px-[13px] py-2.5 text-[15px]"
            : "gap-2.5 px-[13px] py-[11px] text-row",
        active ? ITEM_ACTIVE : ITEM_INACTIVE,
      )}
    >
      {Icon ? (
        <Icon className="size-[18px] shrink-0" strokeWidth={1.7} />
      ) : (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      )}
      {!compact && (
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      )}
      {count !== null && <CountBadge count={count} compact={compact} />}
    </Link>
  );
}

function AccountCard() {
  return (
    <div className="mx-3.5 mb-3.5">
      <AuthAccountMenu
        renderTrigger={({ displayName, initials, open }) => (
          <button
            type="button"
            aria-label={`Open account menu for ${displayName}`}
            aria-expanded={open}
            className="flex w-full items-center gap-[11px] rounded-[12px] border border-sap-border bg-card p-3 text-left transition-colors duration-150 hover:bg-sap-nested focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-avatar text-[13px] font-semibold text-ink-soft">
              {initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-meta font-semibold text-foreground">
                {displayName}
              </span>
              <span className="block text-[12.5px] text-ink-meta">
                Settings
              </span>
            </span>
          </button>
        )}
      />
    </div>
  );
}

/**
 * The full sidebar: identity, the navigation groups, and the account card.
 * Choosing an item also closes the compact drawer. The shell passes its
 * collapse control in while the desktop sidebar is expanded, so the control
 * sits on the region it changes.
 */
export function Sidebar({
  navigation,
  counts,
  toggle,
}: NavigationProps & { toggle?: ReactNode }) {
  const location = useLocation();
  const sidebar = useSidebar();
  const session = useAuthStore((s) => s.session);
  const workspaceName =
    session.kind === "authenticated" ? session.context.workspace.name : null;

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-sap-border bg-sap-sidebar text-foreground">
      <div className="flex items-center gap-3 px-5 pb-[18px] pt-[22px]">
        <Brand />
        <span className="flex min-w-0 flex-col">
          <span className="text-row font-semibold tracking-[-0.01em]">
            dbu6
          </span>
          {workspaceName && (
            <span className="truncate text-[13px] text-ink-meta">
              {workspaceName}
            </span>
          )}
        </span>
        {toggle && (
          <div
            data-shell-sidebar-toggle
            data-sidebar-toggle-location="sidebar"
            className="ml-auto flex shrink-0"
          >
            {toggle}
          </div>
        )}
      </div>
      <nav
        aria-label="Primary"
        className="flex-1 overflow-y-auto px-3 py-1.5"
        onClick={sidebar.closeDrawer}
      >
        {navigation.map((section) => (
          <section
            key={section.label}
            className="flex flex-col gap-[3px] pt-3.5 first:pt-0"
          >
            <div className="px-[13px] pb-1 text-label uppercase text-ink-meta">
              {section.label}
            </div>
            {section.items.map((item) => (
              <NavItem
                key={item.to}
                item={item}
                active={isNavigationItemActive(item, location)}
                count={badgeCount(item, counts)}
              />
            ))}
          </section>
        ))}
      </nav>
      <AccountCard />
    </aside>
  );
}

const RAIL_ITEMS = 8;
const BOTTOM_BAR_ITEMS = 3;

/**
 * Keeps common destinations visible at medium widths: the first eight items,
 * plus the active one when it is further down. Browse still reaches every
 * item, and the shell control opens the full sidebar as a drawer.
 */
export function NavigationRail({ navigation, counts }: NavigationProps) {
  const location = useLocation();
  const allItems = navigationItems(navigation);
  const activeItem = allItems.find((item) =>
    isNavigationItemActive(item, location),
  );
  const items = activeItem
    ? includeActiveRailItem(allItems.slice(0, RAIL_ITEMS), activeItem)
    : allItems.slice(0, RAIL_ITEMS);

  return (
    <aside className="hidden h-full w-[68px] shrink-0 flex-col items-center border-r border-sap-border bg-sap-sidebar py-4 text-foreground md:flex">
      <Brand size={30} />
      <nav aria-label="Primary" className="mt-5 flex flex-col gap-1">
        {items.map((item) => (
          <NavItem
            key={item.to}
            item={item}
            active={isNavigationItemActive(item, location)}
            count={badgeCount(item, counts)}
            compact
          />
        ))}
      </nav>
      <div className="flex-1" />
      <NavigationPicker
        navigation={navigation}
        counts={counts}
        trigger="rail"
      />
    </aside>
  );
}

/**
 * Keeps the first three destinations within thumb reach on a phone. Browse
 * lists every destination, and the shell control still opens the drawer.
 */
export function MobileBottomNav({ navigation, counts }: NavigationProps) {
  const location = useLocation();
  const stableItems = navigationItems(navigation).slice(0, BOTTOM_BAR_ITEMS);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-[var(--sap-z-shell-sticky)] flex h-[56px] items-center justify-around border-t border-sap-border bg-sap-sidebar/95 px-2 md:hidden"
    >
      {stableItems.map((item) => (
        <BottomBarItem
          key={item.to}
          item={item}
          active={isNavigationItemActive(item, location)}
          count={badgeCount(item, counts)}
        />
      ))}
      <NavigationPicker
        navigation={navigation}
        counts={counts}
        trigger="mobile"
      />
    </nav>
  );
}

function BottomBarItem({
  item,
  active,
  count,
}: {
  item: NavigationItem;
  active: boolean;
  count: number | null;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      aria-label={count === null ? undefined : `${item.label}, ${count}`}
      className={cn(
        ITEM_BASE,
        "relative h-12 min-w-[64px] flex-col justify-center gap-1 rounded-control px-2 text-[13px]",
        active ? ITEM_ACTIVE : ITEM_INACTIVE,
      )}
    >
      {Icon ? (
        <Icon className="size-[18px]" strokeWidth={1.7} />
      ) : (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      )}
      <span className="max-w-[80px] truncate">{item.label}</span>
      {count !== null && <CountBadge count={count} compact />}
    </Link>
  );
}

/** A popup listing every destination, for the rail and the bottom bar. */
export function NavigationPicker({
  navigation,
  counts,
  trigger,
}: NavigationProps & { trigger: "rail" | "mobile" }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const items = useMemo(() => navigationItems(navigation), [navigation]);
  const activeItem = items.find((item) =>
    isNavigationItemActive(item, location),
  );

  const buttonClass = cn(
    ITEM_BASE,
    ITEM_INACTIVE,
    "rounded-control",
    trigger === "rail"
      ? "size-11 justify-center"
      : "h-12 min-w-[64px] flex-col justify-center gap-1 px-2 text-[13px]",
  );
  const panelClass =
    trigger === "rail"
      ? "absolute bottom-0 left-full ml-3 w-[min(360px,calc(100vw-24px))]"
      : "absolute bottom-full right-0 mb-2 w-[min(360px,calc(100vw-24px))]";

  return (
    <div className="relative">
      <button
        type="button"
        className={buttonClass}
        title="Open navigation"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ListFilter className="size-[18px]" strokeWidth={1.7} />
        {trigger === "mobile" && <span>Browse</span>}
      </button>
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-[calc(var(--sap-z-popover)-1)] cursor-default bg-transparent"
          onClick={() => setOpen(false)}
        />
      )}
      {open && (
        <div
          className={cn(
            panelClass,
            "z-[var(--sap-z-popover)] max-h-[360px] overflow-y-auto rounded-card border border-sap-border bg-popover p-1.5 text-row text-popover-foreground shadow-lg",
          )}
        >
          {items.map((item) => {
            const count = badgeCount(item, counts);
            return (
              <button
                key={item.to}
                type="button"
                className={cn(
                  ITEM_BASE,
                  "w-full gap-2.5 rounded-control px-3 py-2.5 text-left",
                  activeItem?.to === item.to ? ITEM_ACTIVE : ITEM_INACTIVE,
                )}
                onClick={() => {
                  navigate(item.to);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {count !== null && <CountBadge count={count} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function includeActiveRailItem(
  visibleItems: NavigationItem[],
  activeItem: NavigationItem,
): NavigationItem[] {
  if (visibleItems.some((item) => item.to === activeItem.to)) {
    return visibleItems;
  }
  if (visibleItems.length < RAIL_ITEMS) {
    return [...visibleItems, activeItem];
  }
  return [...visibleItems.slice(0, RAIL_ITEMS - 1), activeItem];
}

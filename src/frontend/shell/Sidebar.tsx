import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@sapporta/ui/cn";
import {
  AuthAccountMenu,
  isNavigationItemActive,
  useSidebar,
} from "@sapporta/frontend/shell";
import { useAuthStore } from "@sapporta/frontend/auth";
import {
  badgeCount,
  type Navigation,
  type NavigationCounts,
  type NavigationItem,
} from "./navigation";

/*
 * dbu6's own sidebar and bottom bar. They follow the redesign's sidebar spec
 * (PLAN.md §4.6) and reuse Sapporta only for behaviour: the sidebar
 * controller, the active-item rule and the account menu. The navigation is
 * six items, so nothing here overflows: the sidebar (and the drawer on
 * compact screens) lists every item, and the bottom bar the everyday ones.
 */

interface NavigationProps {
  navigation: Navigation;
  counts: NavigationCounts;
}

/** The 28px green tile that stands for the app. */
export function Brand({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[8px] bg-primary font-bold text-primary-foreground"
      style={{ width: size, height: size, fontSize: size / 2 }}
    >
      d
    </span>
  );
}

/*
 * An item is a wash of ink over the sidebar, never a raised card: a hover
 * shows at once rather than fading in, and the current page is a deeper wash
 * in darker text at the same weight, so its label keeps its width.
 */
const ITEM_BASE =
  "flex items-center font-medium no-underline transition-[background-color] duration-[20ms] ease-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60";
const ITEM_INACTIVE = "text-sap-nav-fg hover:bg-sap-nav-hover";
const ITEM_ACTIVE = "bg-sap-nav-selected text-foreground";

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
    <span className="tnum shrink-0 rounded-full bg-attention px-2 py-0.5 font-mono text-[12px] font-medium text-primary-foreground">
      {count}
    </span>
  );
}

export function NavItem({
  item,
  active,
  count,
  secondary = false,
  rail = false,
}: {
  item: NavigationItem;
  active: boolean;
  count: number | null;
  /** The smaller style of the group below the rule. */
  secondary?: boolean;
  /**
   * The collapsed sidebar's form: the same row with its label hidden and its
   * count shown as a dot, so the icon stays in place when the sidebar opens.
   */
  rail?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      aria-label={count === null ? undefined : `${item.label}, ${count}`}
      className={cn(
        ITEM_BASE,
        "relative min-h-sap-ctl gap-1.5 rounded-control px-1 py-0.5",
        secondary ? "text-meta" : "text-row",
        active ? ITEM_ACTIVE : ITEM_INACTIVE,
      )}
    >
      <span className="flex size-[22px] shrink-0 items-center justify-center text-sap-nav-icon">
        {Icon ? (
          <Icon className="size-[18px]" strokeWidth={1.5} />
        ) : (
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-current"
          />
        )}
      </span>
      <span className={cn("min-w-0 flex-1 truncate", rail && "sr-only")}>
        {item.label}
      </span>
      {count !== null && <CountBadge count={count} compact={rail} />}
    </Link>
  );
}

/**
 * The account menu's trigger: a card with the person's name, or in the
 * collapsed rail only their initials, centred under the rail's icons.
 */
function AccountCard({
  rail,
  onActionComplete,
}: {
  rail: boolean;
  onActionComplete: () => void;
}) {
  if (rail) {
    return (
      <div className="mx-2 mb-2 flex w-(--height-sap-ctl) justify-center">
        <AuthAccountMenu
          onActionComplete={onActionComplete}
          renderTrigger={({ displayName, initials, open }) => (
            <button
              type="button"
              aria-label={`Open account menu for ${displayName}`}
              aria-expanded={open}
              className="flex size-(--height-sap-ctl) items-center justify-center rounded-full transition-shadow duration-150 hover:ring-2 hover:ring-sap-border focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-avatar text-[12px] font-semibold text-ink-soft">
                {initials}
              </span>
            </button>
          )}
        />
      </div>
    );
  }

  return (
    <div className="mx-2 mb-2">
      <AuthAccountMenu
        onActionComplete={onActionComplete}
        renderTrigger={({ displayName, initials, open }) => (
          <button
            type="button"
            aria-label={`Open account menu for ${displayName}`}
            aria-expanded={open}
            className="flex w-full items-center gap-2 rounded-card border border-sap-border bg-card p-2 text-left transition-colors duration-150 hover:bg-sap-nested focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-avatar text-[12px] font-semibold text-ink-soft">
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
 * The full sidebar: the shell's control, identity, the everyday items, a
 * rule, the rest, and the account card. Choosing an item also closes the
 * compact drawer.
 *
 * On desktop the shell passes its control in both while the sidebar is
 * expanded and while it is collapsed to the rail. The control comes first in
 * the header, in a slot as wide as the rail's icon column, so it stays in one
 * place on screen and lines up with the icons at either density. The slot
 * is as tall as the name over the workspace, so the header keeps its height
 * and the items keep their rows when the rail opens to the full sidebar. In
 * the rail, the header shows only the control and each item shows only its
 * icon.
 *
 * Choosing a destination, or an item in the account menu, closes the sidebar
 * that hovering opened, so the page is not left under it.
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
  const rail = sidebar.rail;

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col bg-sap-nav text-foreground",
        rail ? "w-full" : "w-[216px]",
      )}
    >
      <div className="flex items-center gap-2 px-2 pb-2 pt-3">
        {toggle && (
          <div
            data-shell-sidebar-toggle
            data-sidebar-toggle-location="sidebar"
            className="flex h-10 w-(--height-sap-ctl) shrink-0 items-center justify-center"
          >
            {toggle}
          </div>
        )}
        {!rail && (
          <>
            <Brand />
            <span className="flex min-w-0 flex-col">
              <span className="text-row font-semibold tracking-[-0.01em]">
                dbu6
              </span>
              {workspaceName && (
                <span className="truncate text-meta text-ink-meta">
                  {workspaceName}
                </span>
              )}
            </span>
          </>
        )}
      </div>
      <nav
        aria-label="Primary"
        className="flex-1 overflow-y-auto px-2 py-1"
        onClick={sidebar.closeTemporary}
      >
        <div className="flex flex-col">
          {navigation.everyday.map((item) => (
            <NavItem
              key={item.to}
              item={item}
              active={isNavigationItemActive(item, location)}
              count={badgeCount(item, counts)}
              rail={rail}
            />
          ))}
        </div>
        <hr className="mx-2 my-2 border-0 border-t border-sap-border" />
        <div className="flex flex-col">
          {navigation.more.map((item) => (
            <NavItem
              key={item.to}
              item={item}
              active={isNavigationItemActive(item, location)}
              count={badgeCount(item, counts)}
              secondary
              rail={rail}
            />
          ))}
        </div>
      </nav>
      <AccountCard rail={rail} onActionComplete={sidebar.closeTemporary} />
    </aside>
  );
}

/**
 * Keeps the everyday destinations within thumb reach on a phone. The rest are
 * in the drawer, which the shell control opens.
 */
export function MobileBottomNav({ navigation, counts }: NavigationProps) {
  const location = useLocation();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-[var(--sap-z-shell-sticky)] flex h-[56px] items-center justify-around border-t border-sap-border bg-sap-nav/95 px-2 md:hidden"
    >
      {navigation.everyday.map((item) => (
        <BottomBarItem
          key={item.to}
          item={item}
          active={isNavigationItemActive(item, location)}
          count={badgeCount(item, counts)}
        />
      ))}
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
  const shown = item.shortLabel ?? item.label;
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      aria-label={
        count !== null
          ? `${item.label}, ${count}`
          : shown === item.label
            ? undefined
            : item.label
      }
      className={cn(
        ITEM_BASE,
        "relative h-12 min-w-[64px] flex-col justify-center gap-1 rounded-control px-2 text-[13px]",
        active ? ITEM_ACTIVE : ITEM_INACTIVE,
      )}
    >
      {Icon ? (
        <Icon className="size-4" strokeWidth={1.7} />
      ) : (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      )}
      <span className="max-w-[80px] truncate">{shown}</span>
      {count !== null && <CountBadge count={count} compact />}
    </Link>
  );
}

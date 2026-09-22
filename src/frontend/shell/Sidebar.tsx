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
  secondary = false,
}: {
  item: NavigationItem;
  active: boolean;
  count: number | null;
  /** The smaller style of the group below the rule. */
  secondary?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      aria-label={count === null ? undefined : `${item.label}, ${count}`}
      className={cn(
        ITEM_BASE,
        "rounded-control",
        secondary
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
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {count !== null && <CountBadge count={count} />}
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
 * The full sidebar: identity, the everyday items, a rule, the rest, and the
 * account card. Choosing an item also closes the compact drawer. The shell
 * passes its collapse control in while the desktop sidebar is expanded, so
 * the control sits on the region it changes.
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
        <div className="flex flex-col gap-[3px]">
          {navigation.everyday.map((item) => (
            <NavItem
              key={item.to}
              item={item}
              active={isNavigationItemActive(item, location)}
              count={badgeCount(item, counts)}
            />
          ))}
        </div>
        <hr className="mx-2 my-3.5 border-0 border-t border-sap-border" />
        <div className="flex flex-col gap-[3px]">
          {navigation.more.map((item) => (
            <NavItem
              key={item.to}
              item={item}
              active={isNavigationItemActive(item, location)}
              count={badgeCount(item, counts)}
              secondary
            />
          ))}
        </div>
      </nav>
      <AccountCard />
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
      className="fixed inset-x-0 bottom-0 z-[var(--sap-z-shell-sticky)] flex h-[56px] items-center justify-around border-t border-sap-border bg-sap-sidebar/95 px-2 md:hidden"
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
        <Icon className="size-[18px]" strokeWidth={1.7} />
      ) : (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      )}
      <span className="max-w-[80px] truncate">{shown}</span>
      {count !== null && <CountBadge count={count} compact />}
    </Link>
  );
}

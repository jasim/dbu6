import { Outlet } from "react-router-dom";
import { cn } from "@sapporta/ui/cn";
import {
  AppPage,
  SidebarProvider,
  SidebarRegion,
  SidebarToggle,
  useSidebar,
} from "@sapporta/frontend/shell";
import { useAuthStore } from "@sapporta/frontend/auth";
import { useSchemaStore } from "@sapporta/frontend/schema";
import { MobileBottomNav, Sidebar } from "./Sidebar";
import type { Navigation } from "./navigation";
import { useNavigationCounts } from "./navigation-counts";

export interface AppShellProps {
  navigation: Navigation;
}

/**
 * dbu6's app shell, composed from Sapporta's sidebar behaviour (the remembered
 * collapse state, the rail and the sidebar that opens from it, the compact
 * drawer, the toggle) around dbu6's own sidebar.
 *
 * On desktop, the control is the first thing in the sidebar header, both in
 * the expanded sidebar and in the rail, so it stays in one place on screen.
 * Compact screens have no rail, so the drawer opener sits over the content's
 * top-left. While it is there, the scroll region carries
 * `--sap-page-header-inset`, which Sapporta's `PageHeader` reads so its title
 * stays clear of it.
 *
 * `main` is the single scroll region. Navigation appears once a visitor has a
 * session; a public page renders on its own.
 *
 * The toast outlet is not here: `BootLoader` remounts this shell whenever the
 * schema store resets (a workspace switch, a time zone change), and a toast
 * posted during that remount would find no outlet. `SapportaApp` renders the
 * `Toaster` above the gate instead.
 */
export function AppShell({ navigation }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppShellLayout navigation={navigation} />
    </SidebarProvider>
  );
}

function AppShellLayout({ navigation }: AppShellProps) {
  const error = useSchemaStore((s) => s.error);
  const session = useAuthStore((s) => s.session);
  const sidebar = useSidebar();
  const showNavigation = session.kind === "authenticated";
  const counts = useNavigationCounts(showNavigation);
  const toggleInSidebar = showNavigation && sidebar.isDesktop;
  const toggleInContent = showNavigation && !toggleInSidebar;
  const toggle = (
    <SidebarToggle className="size-(--height-sap-ctl) rounded-control" />
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        {showNavigation && (
          <SidebarRegion>
            <Sidebar
              navigation={navigation}
              counts={counts}
              toggle={toggleInSidebar ? toggle : undefined}
            />
          </SidebarRegion>
        )}
        <div data-shell-content className="relative min-w-0 flex-1">
          {toggleInContent && (
            <div
              data-shell-sidebar-toggle
              data-sidebar-toggle-location="content"
              className="absolute left-2 top-1 z-[calc(var(--sap-z-shell-sticky)+1)]"
            >
              {toggle}
            </div>
          )}
          <main
            data-shell-scroll-region
            className={cn(
              "flex h-full min-h-0 w-full flex-col overflow-y-auto bg-sap-surface md:pb-0",
              showNavigation && "pb-[56px]",
              toggleInContent && "[--sap-page-header-inset:3rem]",
            )}
          >
            {error ? (
              <AppPage
                title="Could not load the app schema"
                bodyClassName="p-8 text-destructive"
              >
                {error}
              </AppPage>
            ) : (
              <Outlet />
            )}
          </main>
        </div>
        {showNavigation && (
          <MobileBottomNav navigation={navigation} counts={counts} />
        )}
      </div>
    </div>
  );
}

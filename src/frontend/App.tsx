import { Children, isValidElement } from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { Navigate, Route } from "react-router-dom";
import {
  assertNoneTaken,
  routeKey,
  type Dbu6FrontendExtension,
} from "./extension";
import type { Navigation } from "./shell/navigation";
import {
  BarChart3,
  FileUp,
  Home,
  Landmark,
  ListChecks,
  Settings,
  Settings2,
} from "lucide-react";
import { TablePage } from "@sapporta/frontend";
import { Advanced } from "./Advanced";
import { Home as HomePage } from "./home/Home";
import { ImportInstructions } from "./views/import-instructions/ImportInstructions";
import { retiredRoutes } from "./redirects";
import { ReportsIndex } from "./reports/ReportsIndex";
import { reportDefinitions, type ReportDefinition } from "./reports/registry";
import {
  sapportaProtectedRoutes,
  sapportaPublicRoutes,
} from "./SapportaRoutes";
import { BalanceChecksTab } from "./review/BalanceChecksTab";
import { DraftsTab } from "./review/DraftsTab";
import { DuplicatesTab } from "./review/DuplicatesTab";
import { ImproveCategorizationTab } from "./review/ImproveCategorizationTab";
import { Overview } from "./review/Overview";
import { ReviewAccount } from "./review/ReviewAccount";
import { ReviewAccounts } from "./review/ReviewAccounts";
import {
  ReclassifyDraftsRedirect,
  RunCategorizerTab,
} from "./review/RunCategorizerTab";
import { REVIEW_TABS, type ReviewTab } from "./review/routes";
import { AddAccount } from "./add-account/AddAccount";
import { AddOther } from "./add-account/other/AddOther";
import { ADD_OTHER_ROUTE, ADD_ROUTE } from "./add-account/state";
import { AutoImportStatements } from "./views/AutoImportStatements";
import { ImportFreeformTransactions } from "./views/ImportFreeformTransactions";
import { JournalsTable } from "./views/JournalsTable";
import { RenderDraftHledger } from "./views/RenderDraftHledger";
import { Settings as SettingsPage } from "./views/settings/Settings";
import { BalancesStep } from "./setup/BalancesStep";
import { BanksStep } from "./setup/BanksStep";
import { ChartCard } from "./setup/ChartCard";
import { ReviewStep } from "./setup/ReviewStep";
import { StatementsStep } from "./setup/StatementsStep";

/*
 * The sidebar: five everyday destinations, then the door to everything else
 * (PLAN.md §11 P0). Nothing was removed from the product; every screen that
 * left the sidebar is linked from All tools.
 */
const ownNavigation: Navigation = {
  everyday: [
    { label: "Home", icon: Home, to: "/" },
    { label: "Accounts", icon: Landmark, to: "/accounts" },
    {
      label: "Import statements",
      shortLabel: "Import",
      icon: FileUp,
      to: "/import",
    },
    {
      label: "Review",
      icon: ListChecks,
      to: "/review",
      badge: "needsCategory",
    },
    { label: "Reports", icon: BarChart3, to: "/reports" },
  ],
  more: [
    { label: "Settings", icon: Settings, to: "/settings" },
    { label: "All tools", icon: Settings2, to: "/tools" },
  ],
};

// The screen behind each of an account's Review tabs.
const REVIEW_TAB_SCREENS: Record<ReviewTab, ComponentType> = {
  drafts: DraftsTab,
  "improve-categorization": ImproveCategorizationTab,
  "run-categorizer": RunCategorizerTab,
  duplicates: DuplicatesTab,
  "balance-checks": BalanceChecksTab,
};

// `/` is Home. It needs a session, so it renders inside the auth gate.
export const appHomeRoute = <Route index element={<HomePage />} />;

// Routes here render without requiring a signed-in session.
export const appPublicRoutes = <></>;

// Routes here render in the app shell without requiring a signed-in session.
export const appPublicShellRoutes = <></>;

/*
 * The routes in focus mode (add-account/FocusCard.tsx): signed in, but
 * outside the app shell, with no sidebar or navigation. One card at a time.
 */
const focusRoutes = (
  <>
    <Route path={ADD_ROUTE.slice(1)} element={<AddAccount />} />
    <Route path={ADD_OTHER_ROUTE.slice(1)} element={<AddOther />} />
    {/* Card 1, the chart; the old wizard's own path for it too. */}
    <Route path="setup" element={<ChartCard />} />
    <Route path="setup/accounts" element={<ChartCard />} />
  </>
);

// dbu6's routes inside the authenticated app shell, around the reports.
function ownProtectedRoutes(reports: readonly ReportDefinition[]) {
  return (
    <>
      {/* The everyday screens. Until Step 6 rebuilds each one, its route shows
        today's screen, so the sidebar already points where it will. */}
      <Route
        path="accounts"
        element={
          <TablePage
            tableName="accounts"
            gridOptions={{ gridClassName: "accounts-grid" }}
          />
        }
      />
      <Route path="import" element={<AutoImportStatements />} />
      <Route path="review" element={<ReviewAccounts />} />
      <Route path="review/:accountId" element={<ReviewAccount />}>
        <Route index element={<Overview />} />
        {REVIEW_TABS.map((tab) => {
          const TabScreen = REVIEW_TAB_SCREENS[tab];
          return <Route key={tab} path={tab} element={<TabScreen />} />;
        })}
        {/* Matches every other path, which ReviewAccount sends to Overview. */}
        <Route path="*" element={null} />
      </Route>
      <Route path="reports" element={<ReportsIndex reports={reports} />} />
      {reports.map(({ id, Component }) => (
        <Route key={id} path={`reports/${id}`} element={<Component />} />
      ))}
      <Route
        path="reports/:reportName"
        element={<Navigate to="/reports" replace />}
      />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="setup/banks" element={<BanksStep />} />
      <Route path="setup/statements" element={<StatementsStep />} />
      <Route path="setup/balances" element={<BalancesStep />} />
      <Route path="setup/review" element={<ReviewStep />} />
      <Route path="import-instructions" element={<ImportInstructions />} />
      <Route path="tools" element={<Advanced />} />

      {/* The tool screens, linked from All tools. */}
      <Route
        path="views/import-freeform-transactions"
        element={<ImportFreeformTransactions />}
      />
      <Route
        path="views/reclassify-drafts"
        element={<ReclassifyDraftsRedirect />}
      />
      <Route
        path="views/render-draft-hledger"
        element={<RenderDraftHledger />}
      />
      <Route path="tables/journals" element={<JournalsTable />} />

      {retiredRoutes}
    </>
  );
}

/** What the app renders: the sidebar and the routes inside the auth gate. */
export interface App {
  navigation: Navigation;
  protectedRoutes: ReactElement;
  /** Routes that render in focus mode, without the shell. */
  focusRoutes: ReactElement;
}

/**
 * dbu6's app with a project's additions: its reports after ours, its pages
 * after our routes, its navigation entries after ours in the sidebar's
 * second group. Whatever is already taken (a report id, a path, a navigation
 * target) throws, naming it: nothing of ours is replaced.
 */
export function buildApp(extension: Dbu6FrontendExtension = {}): App {
  const reports = reportDefinitions(extension.reports);
  const own = ownProtectedRoutes(reports);
  const pages = extension.routes ?? [];
  assertNoneTaken(
    "A page with the path",
    [
      "",
      ...routePaths(sapportaPublicRoutes),
      ...routePaths(own),
      ...routePaths(focusRoutes),
      ...routePaths(sapportaProtectedRoutes),
    ],
    pages.map((page) => routeKey(page.path)),
  );
  const added = extension.navigation ?? [];
  assertNoneTaken(
    "A navigation entry to",
    [...ownNavigation.everyday, ...ownNavigation.more].map((item) => item.to),
    added.map((item) => item.to),
  );
  return {
    navigation: { ...ownNavigation, more: [...ownNavigation.more, ...added] },
    protectedRoutes: (
      <>
        {own}
        {pages.map(({ path, Component }) => (
          <Route key={path} path={routeKey(path)} element={<Component />} />
        ))}
      </>
    ),
    focusRoutes,
  };
}

/** The top-level `path` of every route in a fragment of `<Route>`s. */
function routePaths(routes: ReactNode): string[] {
  return Children.toArray(routes).flatMap((child) => {
    if (!isValidElement<{ path?: string; children?: ReactNode }>(child)) {
      return [];
    }
    if (child.type !== Route) return routePaths(child.props.children);
    return child.props.path === undefined ? [] : [routeKey(child.props.path)];
  });
}

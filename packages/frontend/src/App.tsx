import type { ComponentType } from "react";
import { Navigate, Route } from "react-router-dom";
import type { Navigation } from "./shell/navigation";
import {
  BarChart3,
  FileUp,
  Home,
  Landmark,
  ListChecks,
  Settings2,
} from "lucide-react";
import { TablePage } from "@sapporta/frontend";
import { Advanced } from "./Advanced";
import { Home as HomePage } from "./home/Home";
import { retiredRoutes } from "./redirects";
import { ReportsIndex } from "./reports/ReportsIndex";
import { reportDefinitions } from "./reports/registry";
import { BalanceChecksTab } from "./review/BalanceChecksTab";
import { DraftsTab } from "./review/DraftsTab";
import { DuplicatesTab } from "./review/DuplicatesTab";
import { Overview } from "./review/Overview";
import { ReviewAccount } from "./review/ReviewAccount";
import { ReviewAccounts } from "./review/ReviewAccounts";
import { REVIEW_TABS, type ReviewTab } from "./review/routes";
import { AutoImportStatements } from "./views/AutoImportStatements";
import { ImportFreeformTransactions } from "./views/ImportFreeformTransactions";
import { JournalsTable } from "./views/JournalsTable";
import { ReclassifyDrafts } from "./views/ReclassifyDrafts";
import { RenderDraftHledger } from "./views/RenderDraftHledger";

/*
 * The sidebar: five everyday destinations, then the door to everything else
 * (PLAN.md §11 P0). Nothing was removed from the product; every screen that
 * left the sidebar is linked from All tools.
 */
export const appNavigation: Navigation = {
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
  more: [{ label: "All tools", icon: Settings2, to: "/tools" }],
};

// The screen behind each of an account's Review tabs.
const REVIEW_TAB_SCREENS: Record<ReviewTab, ComponentType> = {
  drafts: DraftsTab,
  duplicates: DuplicatesTab,
  "balance-checks": BalanceChecksTab,
};

// `/` is Home. It needs a session, so it renders inside the auth gate.
export const appHomeRoute = <Route index element={<HomePage />} />;

// Routes here render without requiring a signed-in session.
export const appPublicRoutes = <></>;

// Routes here render in the app shell without requiring a signed-in session.
export const appPublicShellRoutes = <></>;

// Routes here render inside the authenticated app shell.
export const appProtectedRoutes = (
  <>
    {/* The everyday screens. Until Step 6 rebuilds each one, its route shows
        today's screen, so the sidebar already points where it will. */}
    <Route path="accounts" element={<TablePage tableName="accounts" />} />
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
    <Route path="reports" element={<ReportsIndex />} />
    {reportDefinitions.map(({ id, Component }) => (
      <Route key={id} path={`reports/${id}`} element={<Component />} />
    ))}
    <Route
      path="reports/:reportName"
      element={<Navigate to="/reports" replace />}
    />
    <Route path="tools" element={<Advanced />} />

    {/* The tool screens, linked from All tools. */}
    <Route
      path="views/import-freeform-transactions"
      element={<ImportFreeformTransactions />}
    />
    <Route path="views/reclassify-drafts" element={<ReclassifyDrafts />} />
    <Route path="views/render-draft-hledger" element={<RenderDraftHledger />} />
    <Route path="tables/journals" element={<JournalsTable />} />

    {retiredRoutes}
  </>
);

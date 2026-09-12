import { Route, Navigate } from "react-router-dom";
import type { Navigation } from "@sapporta/frontend/shell";
import {
  BarChart3,
  BookOpenText,
  CirclePlus,
  FileSearch,
  FileUp,
  Home,
  Landmark,
  LayoutList,
  ListChecks,
  Send,
  Settings2,
  Tags,
} from "lucide-react";
import { Advanced } from "./Advanced";
import { defaultReportPath, reportDefinitions } from "./reports/registry";
import { Welcome } from "./Welcome";
import { AutoImportStatements } from "./views/AutoImportStatements";
import { DraftTransactionsTable } from "./views/draft-transactions/DraftTransactionsTable";
import { JournalsTable } from "./views/JournalsTable";
import { PostDrafts } from "./views/PostDrafts";
import { ReclassifyDrafts } from "./views/ReclassifyDrafts";
import { RenderDraftHledger } from "./views/RenderDraftHledger";

// Add protected domain screens here with their navigation items.
export const appNavigation: Navigation = [
  {
    label: "Home",
    items: [{ label: "Accounting home", icon: Home, to: "/welcome" }],
  },
  {
    label: "Set up",
    items: [
      { label: "Accounts", icon: Landmark, to: "/tables/accounts" },
      {
        label: "Add an account",
        icon: CirclePlus,
        to: "/setup/accounts/new",
      },
    ],
  },
  {
    label: "Import",
    items: [
      {
        label: "Import checkpoint",
        icon: FileSearch,
        to: "/reports/last-reconciled",
      },
      {
        label: "Import statements",
        icon: FileUp,
        to: "/views/import-statements",
      },
    ],
  },
  {
    label: "Review drafts",
    items: [
      {
        label: "Draft entries",
        icon: LayoutList,
        to: "/tables/draft_transactions",
      },
      {
        label: "Classify drafts",
        icon: Tags,
        to: "/views/reclassify-drafts",
      },
      {
        label: "Check duplicates",
        icon: ListChecks,
        to: "/reports/duplicate-drafts",
      },
      {
        label: "Verify balances",
        icon: ListChecks,
        to: "/reports/draft-balance-assertions",
      },
    ],
  },
  {
    label: "Finish",
    items: [
      {
        label: "Post reviewed entries",
        icon: Send,
        to: "/views/post-drafts",
      },
    ],
  },
  {
    label: "Explore",
    items: [
      {
        label: "Account ledger",
        icon: BookOpenText,
        to: "/reports/account-ledger",
      },
      {
        label: "Balance sheet",
        icon: Landmark,
        to: "/reports/balance-sheet",
      },
      {
        label: "Income & expenses",
        icon: BarChart3,
        to: "/reports/income-statement",
      },
    ],
  },
  {
    label: "Admin",
    items: [{ label: "Advanced", icon: Settings2, to: "/advanced" }],
  },
];

// Change this when you want `/` to open a different screen.
export const appHomeRoute = (
  <Route index element={<Navigate to="/welcome" replace />} />
);

// Routes here render without requiring a signed-in session.
export const appPublicRoutes = <></>;

// Routes here render in the app shell without requiring a signed-in session.
export const appPublicShellRoutes = (
  <>
    <Route path="welcome" element={<Welcome />} />
  </>
);

// Routes here render inside the authenticated app shell.
export const appProtectedRoutes = (
  <>
    <Route path="advanced" element={<Advanced />} />
    <Route
      path="reports"
      element={<Navigate to={defaultReportPath} replace />}
    />
    {reportDefinitions.map(({ id, Component }) => (
      <Route key={id} path={`reports/${id}`} element={<Component />} />
    ))}
    <Route
      path="reports/:reportName"
      element={<Navigate to={defaultReportPath} replace />}
    />
    <Route path="views/import-statements" element={<AutoImportStatements />} />
    <Route path="views/reclassify-drafts" element={<ReclassifyDrafts />} />
    <Route path="views/render-draft-hledger" element={<RenderDraftHledger />} />
    <Route path="views/post-drafts" element={<PostDrafts />} />
    <Route
      path="tables/draft_transactions"
      element={<DraftTransactionsTable />}
    />
    <Route path="tables/journals" element={<JournalsTable />} />
  </>
);

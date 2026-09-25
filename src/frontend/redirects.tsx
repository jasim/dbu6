import { Navigate, Route, useLocation } from "react-router-dom";
import { ADD_ROUTE } from "./add-account/state";
import { REVIEW_ROUTE } from "./review/routes";
import { SETUP_ROUTE } from "./setup/ChartCard";
import {
  BALANCES_SETTINGS_ROUTE,
  BANKS_SETTINGS_ROUTE,
} from "./views/settings/routes";

/**
 * Paths the old sidebar and the old setup wizard used, and where each lives
 * now (PLAN.md §11 P0, P3; "What leaves /setup"). Bookmarks and history
 * keep working; the search and hash come along, since Sapporta's table page
 * writes its filters to the old table URL.
 */
export const retiredPaths: Readonly<Record<string, string>> = {
  "/welcome": "/",
  "/advanced": "/tools",
  "/tables/accounts": "/accounts",
  "/views/import-statements": "/import",
  "/views/post-drafts": "/review",
  "/opening-balances": BALANCES_SETTINGS_ROUTE,
  "/setup/accounts": SETUP_ROUTE,
  "/setup/banks": BANKS_SETTINGS_ROUTE,
  "/setup/statements": ADD_ROUTE,
  "/setup/balances": BALANCES_SETTINGS_ROUTE,
  "/setup/review": REVIEW_ROUTE,
};

function Redirect({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}

export const retiredRoutes = Object.entries(retiredPaths).map(([from, to]) => (
  <Route key={from} path={from.slice(1)} element={<Redirect to={to} />} />
));

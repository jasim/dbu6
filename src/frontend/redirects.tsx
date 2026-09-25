import { Navigate, Route, useLocation } from "react-router-dom";

/**
 * Paths the old sidebar used, and where each lives now (PLAN.md §11 P0, P3).
 * Bookmarks and history keep working; the search and hash come along, since
 * Sapporta's table page writes its filters to the old table URL.
 */
export const retiredPaths: Readonly<Record<string, string>> = {
  "/welcome": "/",
  "/advanced": "/tools",
  "/tables/accounts": "/accounts",
  "/views/import-statements": "/import",
  "/views/post-drafts": "/review",
  "/opening-balances": "/setup/balances",
};

function Redirect({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}

export const retiredRoutes = Object.entries(retiredPaths).map(([from, to]) => (
  <Route key={from} path={from.slice(1)} element={<Redirect to={to} />} />
));

import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@sapporta/frontend/platform";
import { FRESH_QUERY, useRefetchOnNavigate } from "../queries";
import type { NavigationCounts } from "./navigation";

/**
 * How many drafts still need a category, across every account: the table
 * API's row count (`meta.total`), one cheap request. Home and Review count
 * the same drafts per account through the draft status; moving the badge onto
 * that is a follow-up (PLAN.md §11 P1).
 */
export async function fetchNeedsCategoryCount(): Promise<number> {
  const res = await fetch(
    `${getApiBase()}/tables/draft_transactions?filter[account_id][is]=null&limit=1`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { meta?: { total?: number } };
  return body.meta?.total ?? 0;
}

/**
 * The counts the navigation shows. Read once per screen: each route change
 * refreshes them, so categorising drafts on one screen updates the badge on
 * the next. A failed read leaves the badge out rather than showing a stale or
 * made-up number.
 */
export function useNavigationCounts(enabled: boolean): NavigationCounts {
  const query = useQuery({
    queryKey: ["navigation-counts", "needs-category"],
    queryFn: fetchNeedsCategoryCount,
    enabled,
    ...FRESH_QUERY,
  });
  useRefetchOnNavigate(query.refetch, enabled);
  if (!enabled || query.isError || query.data === undefined) return {};
  return { needsCategory: query.data };
}

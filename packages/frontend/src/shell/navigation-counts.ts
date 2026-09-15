import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { getApiBase } from "@sapporta/frontend/platform";
import type { NavigationCounts } from "./navigation";

/**
 * How many drafts still need a category. Read from the table API's row count
 * (`meta.total`), the way the posting screen counts them.
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
  const { pathname } = useLocation();
  const [counts, setCounts] = useState<NavigationCounts>({});

  useEffect(() => {
    if (!enabled) {
      setCounts({});
      return;
    }
    let current = true;
    fetchNeedsCategoryCount()
      .then((needsCategory) => {
        if (current) setCounts({ needsCategory });
      })
      .catch(() => {
        if (current) setCounts({});
      });
    return () => {
      current = false;
    };
  }, [enabled, pathname]);

  return counts;
}

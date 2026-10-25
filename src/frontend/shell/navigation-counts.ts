import { useQuery } from "@tanstack/react-query";
import { homeSummaryQuery, useRefetchOnNavigate } from "../queries";
import { waitingInUpdate } from "../update/state";
import type { NavigationCounts } from "./navigation";

/**
 * The counts the navigation shows: on Update, how many accounts have
 * something waiting, the rule Update's rows and Overview's status line
 * follow, from the summary they read. Read once per screen: each route change
 * refreshes it, so posting drafts on one screen updates the badge on the
 * next. A failed read leaves the badge out rather than showing a stale or
 * made-up number.
 */
export function useNavigationCounts(enabled: boolean): NavigationCounts {
  const query = useQuery({ ...homeSummaryQuery, enabled });
  useRefetchOnNavigate(query.refetch, enabled);
  if (!enabled || query.isError || query.data === undefined) return {};
  return { waiting: waitingInUpdate(query.data) };
}

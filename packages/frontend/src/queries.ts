import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { ApiError } from "@sapporta/shared/client";
import { homeApi, reviewApi } from "./api";

/*
 * How the screens read the server: one TanStack query per request, with its
 * key defined here so a change can refresh every screen that shows it.
 *
 * Each is fetched again whenever a screen mounts (`staleTime: 0`), showing the
 * cached answer meanwhile: drafts change from the grid and the Classify screen,
 * which don't tell these queries. A 4xx is the server's answer, not a blip, so
 * only a failure without one is retried, once.
 */

export const FRESH_QUERY = {
  staleTime: 0,
  retry: (failures: number, error: unknown) =>
    !(error instanceof ApiError && error.status < 500) && failures < 1,
} as const;

/** Every query that counts drafts. */
const DRAFT_STATUS_KEY = ["draft-status"] as const;

export const homeSummaryQuery = queryOptions({
  queryKey: [...DRAFT_STATUS_KEY, "home"],
  queryFn: () => homeApi.summary({ query: {} }),
  ...FRESH_QUERY,
});

export const reviewAccountsQuery = queryOptions({
  queryKey: [...DRAFT_STATUS_KEY, "review-accounts"],
  queryFn: () =>
    reviewApi.accounts({ query: {} }).then((body) => body.accounts),
  ...FRESH_QUERY,
});

export function reviewAccountQuery(accountId: number) {
  return queryOptions({
    queryKey: [...DRAFT_STATUS_KEY, "review-account", accountId],
    queryFn: () => reviewApi.account({ params: { accountId }, query: {} }),
    ...FRESH_QUERY,
  });
}

/** Refreshes Home, the Review picker and every account's summary. */
export function refreshDraftStatus(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: DRAFT_STATUS_KEY });
}

/**
 * Fetches a mounted query again whenever the route's path changes, not on the
 * first render (the query's mount already fetches). The review frame and the
 * sidebar badge count across screens, so a change made on one screen shows on
 * the next.
 */
export function useRefetchOnNavigate(
  refetch: () => unknown,
  enabled = true,
): void {
  const { pathname } = useLocation();
  const seen = useRef(pathname);
  useEffect(() => {
    if (seen.current === pathname) return;
    seen.current = pathname;
    if (enabled) void refetch();
  }, [pathname, refetch, enabled]);
}

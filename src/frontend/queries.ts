import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  keepPreviousData,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import type { DateSpan } from "../shared/index";
import { ApiError } from "@sapporta/shared/client";
import {
  agentHandoffApi,
  codingAgentApi,
  homeApi,
  openingBalancesApi,
  reviewApi,
  setupApi,
} from "./api";

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

/**
 * Every asset and liability account and its opening entry. It has a key of
 * its own, not the drafts': its screen fetches it on mount, and recording an
 * opening balance leaves the grid's own rows alone while refreshing the
 * screens that count drafts.
 */
export const openingBalancesQuery = queryOptions({
  queryKey: ["opening-balances"],
  queryFn: () => openingBalancesApi.list({ query: {} }),
  ...FRESH_QUERY,
});

/** Every query that depends on the coding agent dbu6 uses. */
const CODING_AGENT_KEY = ["coding-agent"] as const;

/**
 * The coding agents on the server's machine and the one dbu6 uses, for
 * Settings. The server answers with what it detected last; only checking
 * again on Settings runs the agents' CLIs.
 */
export const codingAgentSettingsQuery = queryOptions({
  queryKey: [...CODING_AGENT_KEY, "settings"],
  queryFn: () => codingAgentApi.getCodingAgentSettings(),
  ...FRESH_QUERY,
});

/**
 * How a prompt would be handed off, and to which agent. It changes only when
 * an agent is installed or chosen in Settings, which refreshes it, so it is
 * read once in a while, not on every screen.
 */
export const agentHandoffAvailabilityQuery = queryOptions({
  queryKey: [...CODING_AGENT_KEY, "handoff"],
  queryFn: () => agentHandoffApi.getAgentHandoffAvailability(),
  ...FRESH_QUERY,
  staleTime: 10 * 60_000,
});

/**
 * Who would propose a chart of accounts from the user's description, or why
 * nobody can. Choosing an agent in Settings refreshes it.
 */
export const chartSuggesterQuery = queryOptions({
  queryKey: [...CODING_AGENT_KEY, "chart-suggester"],
  queryFn: () => setupApi.chartSuggester(),
  ...FRESH_QUERY,
});

/** Refreshes Settings and every screen's agent prompt buttons. */
export function refreshCodingAgent(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: CODING_AGENT_KEY });
}

/** Every query the setup wizard reads; each counts or lists what is in the books. */
const SETUP_KEY = ["setup"] as const;

/** Where the setup wizard stands: its steps' state, counted in the books. */
export const setupStatusQuery = queryOptions({
  queryKey: [...SETUP_KEY, "status"],
  queryFn: () => setupApi.setupStatus(),
  ...FRESH_QUERY,
});

/** The starter chart for books with no accounts, or the books' own chart. */
export const chartOfAccountsQuery = queryOptions({
  queryKey: [...SETUP_KEY, "chart-of-accounts"],
  queryFn: () => setupApi.chartOfAccounts(),
  ...FRESH_QUERY,
});

/** Every bank and card statements come from, and what a new one needs. */
export const statementAccountsQuery = queryOptions({
  queryKey: [...SETUP_KEY, "statement-accounts"],
  queryFn: () => setupApi.statementAccounts(),
  ...FRESH_QUERY,
});

/**
 * Refreshes the wizard, and Home, whose first card follows from the
 * accounts the wizard sets up.
 */
export function refreshSetup(client: QueryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: SETUP_KEY }),
    refreshDraftStatus(client),
  ]).then(() => undefined);
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

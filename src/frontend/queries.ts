import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  keepPreviousData,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import type { DateSpan } from "../shared/index";
import { ApiError } from "@sapporta/shared/client";
import { MAX_PAGE_SIZE } from "@sapporta/shared/contracts";
import { mintFilterId } from "@sapporta/shared/filter";
import { fetchTableRows, reloadTGridRows } from "@sapporta/frontend";
// `tableQueryKeys` is not reachable through the package's `.` entry: its
// `export * from './table'` meets the build's `table/query.js` stub, which
// has no declarations beside it. The package publishes this subpath for it.
import { tableQueryKeys } from "@sapporta/frontend/table/query";
import {
  agentHandoffApi,
  categorizationLessonsApi,
  codingAgentApi,
  commentWriterApi,
  homeApi,
  importPresetsApi,
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
 * A statement account's lessons for the categoriser. The user's coding agent
 * deletes each once it is taught, outside the app, so they are read again
 * when the user comes back to the window.
 */
export function categorizationLessonsQuery(accountId: number) {
  return queryOptions({
    queryKey: ["categorization-lessons", accountId],
    queryFn: () =>
      categorizationLessonsApi
        .listCategorizationLessons({ query: { base_account_id: accountId } })
        .then((body) => body.lessons),
    ...FRESH_QUERY,
    refetchOnWindowFocus: true,
  });
}

/**
 * The comment writer's status. It writes in the background, and nothing
 * polls it: a screen reads it when it mounts.
 */
export const commentWriterStatusQuery = queryOptions({
  queryKey: ["comment-writer"],
  queryFn: () => commentWriterApi.getCommentWriterStatus(),
  ...FRESH_QUERY,
});

/** Every institution's accounts and the instruction files each lists. */
export const importPresetsQuery = queryOptions({
  queryKey: ["import-presets"],
  queryFn: () => importPresetsApi.listImportPresets({}),
  ...FRESH_QUERY,
});

/**
 * A preset account's instruction files and the text the coding agent gets
 * from them. The files are edited outside dbu6, so it is read on every mount.
 */
export function accountInstructionsQuery(accountId: number) {
  return queryOptions({
    queryKey: ["import-presets", "instructions", accountId],
    queryFn: () =>
      importPresetsApi.readAccountInstructions({ params: { accountId } }),
    ...FRESH_QUERY,
  });
}

/**
 * The rules in transaction_mappings.mjs, each account checked against the
 * ledger. The file is edited outside dbu6, so it is read on every mount.
 */
export const transactionMappingsQuery = queryOptions({
  queryKey: ["import-presets", "transaction-mappings"],
  queryFn: () => importPresetsApi.readTransactionMappings({}),
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

/**
 * Every query of what setting up the books reads: the chart, the banks and
 * cards, the opening balances. Each counts or lists what is in the books.
 */
const SETUP_KEY = ["setup"] as const;

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
 * Every asset and liability account and its opening entry, for C1 and the
 * Opening balances page. Read again when the window regains focus: C1
 * opens the Accounts page in another tab, and an account added there
 * belongs in its list on return.
 */
export const openingBalancesQuery = queryOptions({
  queryKey: [...SETUP_KEY, "opening-balances"],
  queryFn: () => openingBalancesApi.list({ query: {} }),
  ...FRESH_QUERY,
  refetchOnWindowFocus: true,
});

/**
 * Refreshes what setting up an account changes: the setup reads (its
 * account, its opening), Home and Review (its drafts), and the import
 * presets (its bank, parser and number).
 */
export function refreshSetup(client: QueryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: SETUP_KEY }),
    client.invalidateQueries({ queryKey: importPresetsQuery.queryKey }),
    refreshDraftStatus(client),
  ]).then(() => undefined);
}

/** Refreshes Home, the Review picker and every account's summary. */
export function refreshDraftStatus(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: DRAFT_STATUS_KEY });
}

/**
 * Every account in the books, which the edit form's parent choices are made
 * from. One page is not enough — the parent wanted may be the last account
 * in the books — so it asks for the table API's largest page.
 */
export const accountChartQuery = queryOptions({
  queryKey: [...tableQueryKeys.table("accounts"), "chart"],
  queryFn: async () =>
    (
      await fetchTableRows({
        tableName: "accounts",
        limit: MAX_PAGE_SIZE,
        sort: [{ colId: "name", direction: "asc" }],
      })
    ).data,
  ...FRESH_QUERY,
});

/**
 * Whether anything is posted on one account. The form's "they'll show under
 * X in reports" line is only worth saying when the account has entries or
 * sub-accounts, and this is the one fact the chart doesn't carry.
 *
 * `fixed` wants typed conditions; the page has no schema for this table at
 * hand, and `journal_entries.account_id` is an integer, which Sapporta's
 * `resolveColumnKind` calls the "number" kind.
 */
export function accountHasEntriesQuery(accountId: number) {
  return queryOptions({
    queryKey: [...tableQueryKeys.table("journal_entries"), "any", accountId],
    queryFn: async () =>
      (
        await fetchTableRows({
          tableName: "journal_entries",
          limit: 1,
          fixed: [
            {
              id: mintFilterId("account_id", "eq"),
              column: "account_id",
              op: "eq",
              kind: "number",
              value: accountId,
            },
          ],
        })
      ).data.length > 0,
    ...FRESH_QUERY,
  });
}

/**
 * Refreshes everything an account's name, type, parent or existence changes:
 * the Accounts grid (its page queries and the form's chart), the setup reads,
 * Home and Review. Then the mounted grid fetches its rows again.
 */
export async function refreshAccounts(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: tableQueryKeys.table("accounts") }),
    refreshSetup(client),
  ]);
  reloadTGridRows("accounts");
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

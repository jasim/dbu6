import { POSTING_CHECK_KINDS, type PostingCheckKind } from "dbu6-shared";

/*
 * Review's URLs (PLAN.md §11 P3). An account's Overview is
 * `/review/:accountId`; each tab is its own route under it.
 */

export const REVIEW_ROUTE = "/review";

/**
 * The tab where each posting check is looked into: categories are chosen in
 * the Drafts table, and the other two checks have a tab of their own.
 */
const CHECK_TABS = {
  categories: "drafts",
  duplicates: "duplicates",
  "balance-checks": "balance-checks",
} as const satisfies Record<PostingCheckKind, string>;

export type ReviewTab = (typeof CHECK_TABS)[PostingCheckKind];

/** An account's tabs after Overview, in the checks' order. */
export const REVIEW_TABS: readonly ReviewTab[] = POSTING_CHECK_KINDS.map(
  (kind) => CHECK_TABS[kind],
);

export function checkTab(kind: PostingCheckKind): ReviewTab {
  return CHECK_TABS[kind];
}

export function reviewHref(accountId: number, tab?: ReviewTab): string {
  return tab
    ? `${REVIEW_ROUTE}/${accountId}/${tab}`
    : `${REVIEW_ROUTE}/${accountId}`;
}

/** The Drafts tab filtered to the drafts with no category. */
export function needsCategoryHref(accountId: number): string {
  const query = new URLSearchParams([["filter[account_id][is]", "null"]]);
  return `${reviewHref(accountId, "drafts")}?${query}`;
}

/**
 * Which of an account's pages a path is: a tab, "overview", or null for a
 * path under the account that is neither.
 */
export function reviewPage(
  pathname: string,
  accountId: number,
): ReviewTab | "overview" | null {
  const rest = pathname
    .slice(reviewHref(accountId).length)
    .replace(/^\/|\/$/g, "");
  if (rest === "") return "overview";
  return REVIEW_TABS.find((tab) => tab === rest) ?? null;
}

/** The account id in a Review URL, or null when it isn't one. */
export function parseAccountId(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

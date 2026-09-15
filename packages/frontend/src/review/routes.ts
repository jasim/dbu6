/*
 * Review's URLs (PLAN.md §11 P3). An account's Overview is
 * `/review/:accountId`; each tab is its own route under it.
 */

export const REVIEW_ROUTE = "/review";

export type ReviewTab = "drafts" | "duplicates" | "balance-checks";

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

const TABS: readonly ReviewTab[] = ["drafts", "duplicates", "balance-checks"];

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
  return TABS.find((tab) => tab === rest) ?? null;
}

/** The account id in a Review URL, or null when it isn't one. */
export function parseAccountId(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

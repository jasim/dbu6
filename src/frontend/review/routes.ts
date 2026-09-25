import { POSTING_CHECK_KINDS, type PostingCheckKind } from "../../shared/index";

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

type CheckTab = (typeof CHECK_TABS)[PostingCheckKind];

/**
 * Where the user teaches the categoriser from the drafts, beside the Drafts
 * tab, which is for setting a category by hand.
 */
export const IMPROVE_CATEGORIZATION_TAB = "improve-categorization";

/**
 * Where the categoriser runs again over the drafts still without a category,
 * once Improve categorization has taught it.
 */
export const RUN_CATEGORIZER_TAB = "run-categorizer";

/** The tabs that follow Drafts, in order. */
export const CATEGORIZATION_TABS = [
  IMPROVE_CATEGORIZATION_TAB,
  RUN_CATEGORIZER_TAB,
] as const;

export type ReviewTab = CheckTab | (typeof CATEGORIZATION_TABS)[number];

/**
 * An account's tabs after Overview: one per check, in the checks' order, with
 * Improve categorization and Run categorizer after Drafts.
 */
export const REVIEW_TABS: readonly ReviewTab[] = POSTING_CHECK_KINDS.flatMap(
  (kind): ReviewTab[] =>
    kind === "categories"
      ? [CHECK_TABS[kind], ...CATEGORIZATION_TABS]
      : [CHECK_TABS[kind]],
);

export function checkTab(kind: PostingCheckKind): CheckTab {
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

/*
 * What /add hands Review in the URL (PLAN.md "Routes and URL state"):
 * `?imported=1` shows the hand-off note where Review opens, and
 * `?run=setup` marks the first run, whose Review ends with "Your books are
 * set up." once nothing is left to post. Review's own links carry the run,
 * not the note: the note is read once, where the flow landed.
 */
export interface ReviewRun {
  imported: boolean;
  setup: boolean;
}

export function readReviewRun(params: URLSearchParams): ReviewRun {
  return {
    imported: params.get("imported") === "1",
    setup: params.get("run") === "setup",
  };
}

/** `href` with the run's query appended to any query it already has. */
export function withReviewRun(href: string, run: Partial<ReviewRun>): string {
  const params = new URLSearchParams();
  if (run.imported) params.set("imported", "1");
  if (run.setup) params.set("run", "setup");
  const query = params.toString();
  if (query === "") return href;
  return `${href}${href.includes("?") ? "&" : "?"}${query}`;
}

/**
 * Where a later add hands off (card 7): the account's Drafts tab, with the
 * note.
 */
export function draftsHandOffHref(accountId: number): string {
  return withReviewRun(reviewHref(accountId, "drafts"), { imported: true });
}

/**
 * Where the first run hands off (card 7): the account picker, with the note
 * and the run. With one account to review, the picker goes on to its Drafts
 * tab, as a later add does.
 */
export const SETUP_HAND_OFF_HREF = withReviewRun(REVIEW_ROUTE, {
  imported: true,
  setup: true,
});

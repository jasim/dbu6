import {
  isBlock,
  postingBlocks,
  postingChecks,
  type PostingBlock,
  type PostingCheck,
  type PostingCheckKind,
  type ReviewAccountDetail,
} from "../../shared/index";
import type { StatusTone } from "../components/status-chip";
import {
  agree,
  formatBalance,
  formatDaySpan,
  formatShortDate,
  plural,
} from "../format";
import { checkText } from "./posting-checks";
import {
  checkTab,
  needsCategoryHref,
  REVIEW_ROUTE,
  reviewHref,
  withReviewRun,
} from "./routes";

/*
 * What an account's Overview says, as a pure function of its summary
 * (PLAN.md §11 P3): the verdict, one row per check in tab order, why the
 * post button waits, and what posting will do. The rows are the posting
 * gate's own checks (`postingChecks`), so the ticks and a refusal agree.
 */

/** A figure inside a sentence, set in mono. */
export interface Figure {
  figure: string;
}

/** A sentence whose figures are marked, so the page can set them in mono. */
export type Phrase = readonly (string | Figure)[];

export interface OverviewLink {
  label: string;
  to: string;
}

export interface CheckRow {
  check: PostingCheckKind;
  tone: StatusTone;
  text: string;
  /** The tab that fixes it; absent when there is nothing to fix. */
  link?: OverviewLink;
}

export interface OverviewView {
  verdict: string;
  checks: readonly CheckRow[];
  /** The unmet checks, for under the waiting button; absent when ready. */
  waiting?: string;
  /** What posting does; only when nothing blocks it. */
  posting?: Phrase;
  button: string;
}

export interface PostedView {
  verdict: string;
  outcome: Phrase;
  /**
   * The primary action: the next account to review, else importing more,
   * or Home once the first run has set the books up.
   */
  next: OverviewLink;
  /** A quiet second way on, when there is another account. */
  also?: OverviewLink;
}

/**
 * The first run's end (card 8), once nothing is left to post. No net worth:
 * the books are set up, and that is all it says. Home resumes from there.
 */
export const BOOKS_SET_UP = "Your books are set up.";
export const BOOKS_SET_UP_NEXT: OverviewLink = { label: "Go to Home", to: "/" };

export function overviewView(detail: ReviewAccountDetail): OverviewView {
  const { account } = detail;
  const blocks = postingBlocks(account);
  const ready = blocks.length === 0;

  return {
    verdict: ready ? "Ready to add to your books" : "Not ready to add yet",
    checks: postingChecks(account).map((check) => checkRow(check, detail)),
    waiting: ready ? undefined : blocks.map(waitingReason).join(" · "),
    posting: ready ? postingPhrase(detail) : undefined,
    button: `Add ${account.drafts} to my books`,
  };
}

/** One unmet check, as the waiting button lists it: "12 still need a category". */
function waitingReason(block: PostingBlock): string {
  return block.kind === "categories"
    ? `${block.count} still ${agree(block.count, "needs", "need")} a category`
    : checkText(block);
}

/**
 * The Overview once the drafts are in the books. `before` is the summary the
 * post was made from; `others` the accounts that still have drafts. On the
 * first run (`setup`), the links on carry it, and posting the last drafts
 * ends it: the books are set up.
 */
export function postedView(
  before: ReviewAccountDetail,
  draftsPosted: number,
  others: ReviewAccountDetail["other_accounts"],
  setup = false,
): PostedView {
  const next = others[0];
  const outcome: Phrase = [
    `${plural(draftsPosted, "transaction")} added.`,
    ...lastAssertion(before, "is now"),
  ];
  if (next) {
    return {
      verdict: "Added to your books",
      outcome,
      next: {
        label: `Review ${next.name}`,
        to: withReviewRun(reviewHref(next.account_id), { setup }),
      },
      also: {
        label: "All accounts",
        to: withReviewRun(REVIEW_ROUTE, { setup }),
      },
    };
  }
  return setup
    ? { verdict: BOOKS_SET_UP, outcome, next: BOOKS_SET_UP_NEXT }
    : {
        verdict: "Added to your books",
        outcome,
        next: { label: "Import statements", to: "/import" },
      };
}

function checkRow(check: PostingCheck, detail: ReviewAccountDetail): CheckRow {
  if (!isBlock(check)) {
    return {
      check: check.kind,
      tone: check.state === "none" ? "waiting" : "ok",
      text: checkText(check),
    };
  }
  const accountId = detail.account.account_id;
  const tab = reviewHref(accountId, checkTab(check.kind));
  switch (check.kind) {
    case "categories":
      return {
        check: check.kind,
        tone: check.severity,
        text: checkText(check),
        link: {
          label: check.count === 1 ? "See it in Drafts" : "See them in Drafts",
          to: needsCategoryHref(accountId),
        },
      };
    case "duplicates":
      return {
        check: check.kind,
        tone: check.severity,
        text: checkText(check),
        link: { label: "See the duplicates", to: tab },
      };
    case "balance-checks": {
      // A failing check is one of the detail's failing rows, in date order.
      const day = formatShortDate(detail.failing[0].date);
      return {
        check: check.kind,
        tone: check.severity,
        text: `${checkText(check)}, ${check.count === 1 ? "on" : "the first on"} ${day}`,
        link: { label: "See the balance checks", to: tab },
      };
    }
  }
}

function postingPhrase(detail: ReviewAccountDetail): Phrase {
  const { account } = detail;
  const span = account.draft_span
    ? ` from ${formatDaySpan(account.draft_span)}`
    : "";
  return [
    `Adds ${plural(account.drafts, "transaction")}${span}.`,
    ...lastAssertion(detail, "will then be"),
  ];
}

// " The last balance assertion for HDFC Savings is now 3,30,000.00 on
// 13 Sep.", from the last balance the drafts carry; nothing when they carry
// none.
function lastAssertion(detail: ReviewAccountDetail, verb: string): Phrase {
  const { account, closing } = detail;
  if (closing === null) return [];
  return [
    ` The last balance assertion for ${account.name} ${verb} `,
    { figure: formatBalance(closing.balance, account.kind) },
    ` on ${formatShortDate(closing.date)}.`,
  ];
}

/** A phrase as plain text: for titles, labels and tests. */
export function phraseText(phrase: Phrase): string {
  return phrase
    .map((part) => (typeof part === "string" ? part : part.figure))
    .join("");
}

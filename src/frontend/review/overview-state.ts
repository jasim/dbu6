import {
  isBlock,
  postingBlocks,
  postingChecks,
  type PostingBlock,
  type PostingCheck,
  type PostingCheckKind,
  type ReviewAccountDetail,
} from "../../shared/index";
import type { Step } from "../components/progress-steps";
import type { StatusTone } from "../components/status-chip";
import {
  agree,
  formatBalance,
  formatDaySpan,
  formatShortDate,
  plural,
} from "../format";
import { checkText, duplicatesText } from "./posting-checks";
import {
  checkTab,
  needsAccountHref,
  REVIEW_ROUTE,
  reviewHref,
  withReviewRun,
  type ImportCounts,
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
  /** A quiet second line: what the import already categorized. */
  note?: string;
  /** The tab that fixes it; absent when there is nothing to fix. */
  link?: OverviewLink;
}

export interface OverviewView {
  /** The drafts' way into the books, and where they are on it. */
  journey: Step[];
  verdict: string;
  checks: readonly CheckRow[];
  /** The unmet checks, for under the waiting button; absent when ready. */
  waiting?: string;
  /** What posting does; only when nothing blocks it. */
  posting?: Phrase;
  button: string;
}

export interface PostedView {
  journey: Step[];
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

/**
 * The Overview, for an account's drafts. `imported` is what the add that
 * opened the visit imported, for the categorization row's note.
 */
export function overviewView(
  detail: ReviewAccountDetail,
  imported: ImportCounts | null = null,
): OverviewView {
  const { account } = detail;
  const blocks = postingBlocks(account);
  const ready = blocks.length === 0;

  return {
    journey: journey(detail, ready ? "add" : "review"),
    verdict: ready ? "Ready to add to your books" : "Not ready to add yet",
    checks: postingChecks(account).map((check) =>
      checkRow(check, detail, imported),
    ),
    waiting: ready ? undefined : blocks.map(waitingReason).join(" · "),
    posting: ready ? postingPhrase(detail) : undefined,
    button: `Add ${account.drafts} to my books`,
  };
}

/**
 * A draft's way into the books: import, review, add. `at` is the
 * step the drafts wait on, or "posted" once they are in.
 */
function journey(
  detail: ReviewAccountDetail,
  at: "review" | "add" | "posted",
): Step[] {
  const { account } = detail;
  const span = account.draft_span
    ? ` · ${formatDaySpan(account.draft_span)}`
    : "";
  const reviewed = at !== "review";
  return [
    {
      title: "Import as drafts",
      status: "done",
      detail: `${plural(account.drafts, "transaction")}${span}`,
    },
    {
      title: "Review",
      status: reviewed ? "done" : "current",
      detail: reviewed
        ? "Every check passes"
        : "Categorization, duplicates and balances",
    },
    {
      title: "Add to your books",
      status: at === "posted" ? "done" : at === "add" ? "current" : "waiting",
      detail:
        at === "posted"
          ? "They show in your reports"
          : "Then they show in your reports",
    },
  ];
}

/** What the notice an import's Overview opens with says. */
export interface ArrivalNotice {
  title: string;
  facts: { label: string; value: string }[];
  /** The one next step, in a line. */
  next: string;
  /** Where that step is done; absent when it is here, on the Overview. */
  action?: OverviewLink;
}

/**
 * The notice over the Overview a later add lands on: what it imported, how
 * much came categorized, and the one thing to do next, the first check
 * that blocks, in tab order.
 */
export function arrivalNotice(
  detail: ReviewAccountDetail,
  imported: ImportCounts,
): ArrivalNotice {
  const { account } = detail;
  const facts = [
    { label: "Categorized automatically", value: String(imported.categorized) },
    { label: "Need an account", value: String(account.uncategorised) },
    ...(account.duplicates > 0
      ? [{ label: "Possible duplicates", value: String(account.duplicates) }]
      : []),
    ...(account.failing_checks > 0
      ? [
          {
            label: "Balance checks failing",
            value: String(account.failing_checks),
          },
        ]
      : []),
  ];
  const title = `${plural(imported.drafts, "transaction")} imported`;
  const [block] = postingBlocks(account);
  if (block === undefined) {
    return { title, facts, next: "Next: add them to your books." };
  }
  const row = checkRow(block, detail, null);
  switch (block.kind) {
    case "categorization":
      return {
        title,
        facts,
        next: `Next: give ${block.count === 1 ? "it" : `the ${block.count}`} an account, then add them to your books.`,
        action: { label: `Categorize ${block.count}`, to: row.link!.to },
      };
    case "duplicates":
      return {
        title,
        facts,
        next: `Next: check the ${duplicatesText(block.count)}.`,
        action: row.link,
      };
    case "balance-checks":
      return {
        title,
        facts,
        next: "Next: find out why the balances don't add up.",
        action: row.link,
      };
  }
}

/** One unmet check, as the waiting button lists it: "12 still need an account". */
function waitingReason(block: PostingBlock): string {
  return block.kind === "categorization"
    ? `${block.count} still ${agree(block.count, "needs", "need")} an account`
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
  const posted = journey(before, "posted");
  const outcome: Phrase = [
    `${plural(draftsPosted, "transaction")} added.`,
    ...lastAssertion(before, "is now"),
  ];
  if (next) {
    return {
      journey: posted,
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
    ? {
        journey: posted,
        verdict: BOOKS_SET_UP,
        outcome,
        next: BOOKS_SET_UP_NEXT,
      }
    : {
        journey: posted,
        verdict: "Added to your books",
        outcome,
        next: { label: "Import statements", to: "/import" },
      };
}

function checkRow(
  check: PostingCheck,
  detail: ReviewAccountDetail,
  imported: ImportCounts | null,
): CheckRow {
  const note =
    check.kind === "categorization" && imported !== null
      ? `${imported.categorized} of ${imported.drafts} categorized automatically`
      : undefined;
  if (!isBlock(check)) {
    return {
      check: check.kind,
      tone: check.state === "none" ? "waiting" : "ok",
      text: checkText(check),
      note,
    };
  }
  const accountId = detail.account.account_id;
  const tab = reviewHref(accountId, checkTab(check.kind));
  switch (check.kind) {
    case "categorization":
      return {
        check: check.kind,
        tone: check.severity,
        text: checkText(check),
        note,
        link: {
          label: check.count === 1 ? "See it in Drafts" : "See them in Drafts",
          to: needsAccountHref(accountId),
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

import {
  isBlock,
  postingBlocks,
  postingChecks,
  type PostingCheck,
  type PostingCheckKind,
  type ReviewAccount,
  type ReviewAccountDetail,
} from "../../shared/index";
import type { StatusTone } from "../components/status-chip";
import { formatShortDate, plural } from "../format";
import { UPDATE_ROUTE } from "../update/routes";
import { accountsText, checkText } from "./posting-checks";
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
 * (PLAN.md §11 P3): a status line, what must be fixed before the drafts can
 * be added, each with the screen that fixes it, then the checks that passed.
 * The rows are the posting gate's own checks (`postingChecks`), so the
 * ticks and a refusal agree.
 * Drafts whose checks pass counting another account's drafts (`relies_on`)
 * wait on that account: Review's Add all adds them together once it is
 * ready, and their own button waits.
 */

export interface OverviewLink {
  label: string;
  to: string;
}

/** What the drafts' relying on another account's drafts is called here. */
export type OverviewRowKind = PostingCheckKind | "relies-on";

/** Something to fix before the drafts can be added, and where. */
export interface ProblemRow {
  check: OverviewRowKind;
  tone: Extract<StatusTone, "attention" | "problem">;
  text: string;
  /** A quiet second line: what the import already categorized. */
  note?: string;
  link: OverviewLink;
}

/** A check that passed, or had nothing to check. */
export interface PassedRow {
  check: PostingCheckKind;
  tone: Extract<StatusTone, "ok" | "waiting">;
  text: string;
  note?: string;
}

export interface OverviewView {
  status: string;
  problems: readonly ProblemRow[];
  passed: readonly PassedRow[];
  /** Whether Add to my books can run. */
  ready: boolean;
  /**
   * Where Fix these goes: under the problems it fixes, or beside the add
   * when it has only rule requests for the agent; absent when it has
   * nothing to fix.
   */
  fix?: "problems" | "actions";
}

export interface PostedView {
  status: string;
  /**
   * The primary action: Review's Add all while other accounts are ready to
   * add, else the next account to review, else Overview.
   */
  next: OverviewLink;
  /** A quiet second way on, when there is another account. */
  also?: OverviewLink;
}

/**
 * The first run's end (card 8), once nothing is left to post. No net worth
 * here: the books are set up, and that is all it says. What the money did
 * is Overview's to show, and with something posted it shows it.
 */
export const BOOKS_SET_UP = "Your books are set up.";
export const BOOKS_SET_UP_NEXT: OverviewLink = {
  label: "See your money",
  to: "/",
};

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
  const relies = blocks.length === 0 && account.relies_on.length > 0;
  const ready = blocks.length === 0 && !relies;

  const problems: ProblemRow[] = [];
  const passed: PassedRow[] = [];
  for (const check of postingChecks(account)) {
    const note =
      check.kind === "categorization" && imported !== null
        ? `${imported.categorized} of ${imported.drafts} categorized automatically`
        : undefined;
    if (isBlock(check)) {
      problems.push({ ...problemRow(check, detail), ...(note && { note }) });
    } else if (check.kind === "balance-checks" && relies) {
      problems.push(reliesOnRow(account));
    } else {
      passed.push({ ...passedRow(check), ...(note && { note }) });
    }
  }

  return {
    status: ready
      ? `${plural(account.drafts, "transaction")} ready to add`
      : `${plural(account.drafts, "transaction")} in drafts`,
    problems,
    passed,
    ready,
    fix:
      blocks.length > 0
        ? "problems"
        : account.rule_requests > 0
          ? "actions"
          : undefined,
  };
}

/**
 * Whether the coding agent has something to fix in an account's drafts: a
 * check that blocks, or rule requests waiting to be turned into rules.
 * Drafts that go in with another account's leave it nothing.
 */
export function agentFixes(account: ReviewAccount): boolean {
  return account.rule_requests > 0 || postingBlocks(account).length > 0;
}

/** What the notice an import's Overview opens with says. */
export interface ArrivalNotice {
  title: string;
  facts: { label: string; value: string }[];
  /** The one next step, in a line. */
  next: string;
  /**
   * Where that step is done: a link, or "fix" for Fix these, which hands
   * what is left to the coding agent; absent when it is here, on the
   * Overview.
   */
  action?: OverviewLink | "fix";
}

/**
 * The notice over the Overview a later add lands on: what it imported, how
 * much came categorized, and the one thing to do next: hand what is left to
 * the coding agent, or add these with the accounts they go in with, or add
 * these.
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
  if (agentFixes(account)) {
    return {
      title,
      facts,
      next: "Next: hand what's left to your agent, then add them to your books.",
      action: "fix",
    };
  }
  const others = account.relies_on;
  if (others.length === 0) {
    return { title, facts, next: "Next: add them to your books." };
  }
  return {
    title,
    facts,
    next: `Next: add them with ${accountsText(others)} on Review's Add all, once ${others.length === 1 ? "it is" : "they are"} ready. These balance checks count ${others.length === 1 ? "its" : "their"} drafts.`,
    action: { label: "Go to Review", to: REVIEW_ROUTE },
  };
}

/**
 * The Overview once the drafts are in the books. `before` is the summary the
 * post was made from; `others` the accounts that still have drafts, of which
 * `readyOthers` are ready to add. On the first run (`setup`), the links on
 * carry it, and posting the last drafts ends it: the books are set up.
 */
export function postedView(
  before: ReviewAccountDetail,
  draftsPosted: number,
  others: ReviewAccountDetail["other_accounts"],
  {
    setup = false,
    readyOthers = 0,
  }: { setup?: boolean; readyOthers?: number } = {},
): PostedView {
  const next = others[0];
  const added = plural(draftsPosted, "transaction");
  const status = `${added} added to your books`;
  if (next && readyOthers > 0) {
    return {
      status,
      next: {
        label: `Add ${plural(readyOthers, "ready account")}`,
        to: withReviewRun(REVIEW_ROUTE, { setup }),
      },
      also: {
        label: `Review ${next.name}`,
        to: withReviewRun(reviewHref(next.account_id), { setup }),
      },
    };
  }
  if (next) {
    return {
      status,
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
        status: `${added} added. ${BOOKS_SET_UP}`,
        next: BOOKS_SET_UP_NEXT,
      }
    : {
        status,
        next: BOOKS_SET_UP_NEXT,
        also: { label: "Update your books", to: UPDATE_ROUTE },
      };
}

// A check that blocks, said as a problem, with the tab that fixes it.
function problemRow(
  check: Extract<PostingCheck, { state: "blocks" }>,
  detail: ReviewAccountDetail,
): ProblemRow {
  const accountId = detail.account.account_id;
  const tab = reviewHref(accountId, checkTab(check.kind));
  switch (check.kind) {
    case "categorization":
      return {
        check: check.kind,
        tone: check.severity,
        text: checkText(check),
        link: {
          label: "Categorize in Drafts",
          to: needsAccountHref(accountId),
        },
      };
    case "duplicates":
      return {
        check: check.kind,
        tone: check.severity,
        text: checkText(check),
        link: { label: "Compare duplicates", to: tab },
      };
    case "balance-checks": {
      // A failing check is one of the detail's failing rows, in date order.
      const day = formatShortDate(detail.failing[0].date);
      return {
        check: check.kind,
        tone: check.severity,
        text: `${checkText(check)}, ${check.count === 1 ? "on" : "the first on"} ${day}`,
        link: { label: "Open balance checks", to: tab },
      };
    }
  }
}

// Balance checks that pass only counting other accounts' drafts: those
// drafts are already imported, so the two go in together, on Review.
function reliesOnRow(account: ReviewAccount): ProblemRow {
  const others = account.relies_on;
  return {
    check: "relies-on",
    tone: "attention",
    text: `These balance checks count ${accountsText(others)}'s drafts. Add ${others.length === 1 ? "both" : "them all"} together on Review.`,
    link: { label: "Go to Review", to: REVIEW_ROUTE },
  };
}

// A check that passed, or had nothing to check, in the Overview's words.
function passedRow(check: Exclude<PostingCheck, { state: "blocks" }>): PassedRow {
  switch (check.kind) {
    case "categorization":
      return {
        check: check.kind,
        tone: "ok",
        text:
          check.drafts === 1
            ? "Accounts: the transaction is categorized"
            : `Accounts: all ${check.drafts} transactions are categorized`,
      };
    case "duplicates":
      return {
        check: check.kind,
        tone: "ok",
        text: "No duplicate entries found",
      };
    case "balance-checks":
      return check.state === "none"
        ? {
            check: check.kind,
            tone: "waiting",
            text: "No balance assertions in these drafts, so no balance checks run",
          }
        : {
            check: check.kind,
            tone: "ok",
            text: "Balance checks: statement balance and our computed balance match",
          };
  }
}

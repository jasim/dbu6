import {
  findBlock,
  postingBlocks,
  type PostingBlock,
  type ReviewAccountDetail,
} from "dbu6-shared";
import type { StatusTone } from "../components/status-chip";
import {
  formatBalance,
  formatDaySpan,
  formatShortDate,
  plural,
} from "../format";
import { needsCategoryHref, reviewHref } from "./routes";

/*
 * What an account's Overview says, as a pure function of its summary
 * (PLAN.md §11 P3): the verdict, one row per check in tab order, why the
 * post button waits, and what posting will do. The checks are the posting
 * gate's own blocks (`postingBlocks`), so the ticks and a refusal agree.
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
  check: "categories" | "duplicates" | "balance-checks";
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
  /** The primary action: the next account to review, or importing more. */
  next: OverviewLink;
  /** A quiet second way on, when there is another account. */
  also?: OverviewLink;
}

export function overviewView(detail: ReviewAccountDetail): OverviewView {
  const { account } = detail;
  const blocks = postingBlocks(account);
  const ready = blocks.length === 0;

  return {
    verdict: ready ? "Ready to add to your books" : "Not ready to add yet",
    checks: [
      categoriesCheck(detail, blocks),
      duplicatesCheck(detail, blocks),
      balanceChecksCheck(detail, blocks),
    ],
    waiting: ready ? undefined : blocks.map(waitingReason).join(" · "),
    posting: ready ? postingPhrase(detail) : undefined,
    button: `Add ${account.drafts} to my books`,
  };
}

/** One unmet check, as the waiting button lists it. */
function waitingReason(block: PostingBlock): string {
  switch (block.kind) {
    case "uncategorised":
      return `${block.count} still ${block.count === 1 ? "needs" : "need"} a category`;
    case "duplicates":
      return plural(block.count, "possible duplicate");
    case "failing-checks":
      return `${plural(block.count, "balance check")} ${block.count === 1 ? "fails" : "fail"}`;
  }
}

/**
 * The Overview once the drafts are in the books. `before` is the summary the
 * post was made from; `others` the accounts that still have drafts.
 */
export function postedView(
  before: ReviewAccountDetail,
  draftsPosted: number,
  others: ReviewAccountDetail["other_accounts"],
): PostedView {
  const next = others[0];
  return {
    verdict: "Added to your books",
    outcome: [
      `${plural(draftsPosted, "transaction")} added.`,
      ...checkedTo(before, "is"),
    ],
    ...(next
      ? {
          next: {
            label: `Review ${next.name}`,
            to: reviewHref(next.account_id),
          },
          also: { label: "All accounts", to: "/review" },
        }
      : { next: { label: "Import statements", to: "/import" } }),
  };
}

function categoriesCheck(
  { account }: ReviewAccountDetail,
  blocks: readonly PostingBlock[],
): CheckRow {
  const missing = findBlock(blocks, "uncategorised");
  if (!missing) {
    return {
      check: "categories",
      tone: "ok",
      text:
        account.drafts === 1
          ? "The transaction has a category"
          : `All ${account.drafts} transactions have a category`,
    };
  }
  return {
    check: "categories",
    tone: missing.severity,
    text: `${plural(missing.count, "transaction")} ${missing.count === 1 ? "needs" : "need"} a category`,
    link: {
      label: missing.count === 1 ? "See it in Drafts" : "See them in Drafts",
      to: needsCategoryHref(account.account_id),
    },
  };
}

function duplicatesCheck(
  { account }: ReviewAccountDetail,
  blocks: readonly PostingBlock[],
): CheckRow {
  const duplicates = findBlock(blocks, "duplicates");
  if (!duplicates) {
    return {
      check: "duplicates",
      tone: "ok",
      text: "No possible duplicates",
    };
  }
  return {
    check: "duplicates",
    tone: duplicates.severity,
    text: plural(duplicates.count, "possible duplicate"),
    link: {
      label: "See the duplicates",
      to: reviewHref(account.account_id, "duplicates"),
    },
  };
}

function balanceChecksCheck(
  detail: ReviewAccountDetail,
  blocks: readonly PostingBlock[],
): CheckRow {
  const { account, failing } = detail;
  if (detail.balance_checks === 0) {
    return {
      check: "balance-checks",
      tone: "waiting",
      text: "These drafts have no balance checks",
    };
  }
  const failingChecks = findBlock(blocks, "failing-checks");
  const first = failing[0];
  if (!failingChecks || !first) {
    return {
      check: "balance-checks",
      tone: "ok",
      text: "Every balance check passes",
    };
  }
  const day = formatShortDate(first.date);
  return {
    check: "balance-checks",
    tone: failingChecks.severity,
    text:
      failingChecks.count === 1
        ? `1 balance check fails, on ${day}`
        : `${failingChecks.count} balance checks fail, the first on ${day}`,
    link: {
      label: "See the balance checks",
      to: reviewHref(account.account_id, "balance-checks"),
    },
  };
}

function postingPhrase(detail: ReviewAccountDetail): Phrase {
  const { account } = detail;
  const span =
    account.first_date && account.last_date
      ? ` from ${formatDaySpan(account.first_date, account.last_date)}`
      : "";
  return [
    `Adds ${plural(account.drafts, "transaction")}${span}.`,
    ...checkedTo(detail, "will then be"),
  ];
}

// " HDFC Savings is checked to 13 Sep at ₹3,26,445.00.", from the last
// balance the drafts carry; nothing when they carry none.
function checkedTo(detail: ReviewAccountDetail, verb: string): Phrase {
  const { account, closing } = detail;
  if (closing === null) return [];
  return [
    ` ${account.name} ${verb} checked to ${formatShortDate(closing.date)} at `,
    { figure: formatBalance(closing.balance, account.kind) },
    ".",
  ];
}

/** A phrase as plain text: for titles, labels and tests. */
export function phraseText(phrase: Phrase): string {
  return phrase
    .map((part) => (typeof part === "string" ? part : part.figure))
    .join("");
}

import {
  findBlock,
  isProblem,
  postingBlocks,
  type HomeAccount,
  type HomeSummary,
  type ProblemBlock,
} from "dbu6-shared";
import { reviewHref, REVIEW_ROUTE } from "../review/routes";
import { joinNames, plural } from "../format";

/*
 * What Home says, as a pure function of the summary (PLAN.md §11 P1). In
 * precedence order: no accounts, then whatever blocks the drafts (problems
 * before categories, as `postingBlocks` marks them), then drafts ready to add,
 * then nothing imported, then up to date.
 */

export type HomeStateId =
  | "no-accounts"
  | "nothing-imported"
  | "problems"
  | "uncategorised"
  | "ready"
  | "up-to-date";

export interface HomeLink {
  label: string;
  to: string;
}

export interface HomeCard {
  /** The medallion figure; absent when there is nothing to count. */
  count?: number;
  title: string;
  body: string;
  action: HomeLink;
}

export interface HomeView {
  state: HomeStateId;
  greeting: string;
  card: HomeCard;
}

export function homeState(summary: HomeSummary): HomeView {
  const { accounts, totals } = summary;
  const review = reviewTarget(summary);
  const blocks = postingBlocks(totals);
  const problems = blocks.filter(isProblem);
  const uncategorised = findBlock(blocks, "uncategorised");

  if (accounts.length === 0) {
    return {
      state: "no-accounts",
      greeting: "Let's set up your first account",
      card: {
        title: "Add your first account",
        body: "dbu6 imports statements from the banks and cards you set up. Each needs an account and an import preset.",
        action: { label: "Open accounts", to: "/accounts" },
      },
    };
  }

  if (problems.length > 0) {
    return {
      state: "problems",
      greeting: "A few things to fix first",
      card: {
        count: problems.reduce((sum, block) => sum + block.count, 0),
        title: problemsTitle(problems),
        body: "They have to be fixed before those drafts can be added to your books.",
        action: { label: "Review the drafts", to: review },
      },
    };
  }

  if (uncategorised) {
    const where = named(accounts.filter((a) => a.uncategorised > 0));
    return {
      state: "uncategorised",
      greeting: "You're nearly up to date",
      card: {
        count: uncategorised.count,
        title: `${plural(uncategorised.count, "transaction")} ${
          uncategorised.count === 1 ? "needs" : "need"
        } a category`,
        body: `${
          where
            ? `They're waiting in the drafts for ${where}.`
            : "They're waiting in the drafts."
        } Nothing is added to your books until you've checked them.`,
        action: { label: "Review transactions", to: review },
      },
    };
  }

  if (totals.drafts > 0) {
    return {
      state: "ready",
      greeting: "Ready to add to your books",
      card: {
        count: totals.drafts,
        title: `${plural(totals.drafts, "transaction")} ready to add`,
        body: "The entries are ready for posting.",
        action: { label: "Add them to my books", to: review },
      },
    };
  }

  if (!summary.has_journals) {
    const where = named(accounts);
    return {
      state: "nothing-imported",
      greeting: "Nothing imported yet",
      card: {
        title: "Import your first statement",
        body: `Drop in a statement for ${where}. Nothing reaches your books until you've checked it.`,
        action: { label: "Import statements", to: "/import" },
      },
    };
  }

  return {
    state: "up-to-date",
    greeting: "You're up to date",
    card: {
      title: "Every account is checked to its last statement",
      body: "Import the next statement when it arrives.",
      action: { label: "Import statements", to: "/import" },
    },
  };
}

/**
 * Where the drafts are reviewed: the account's own Review when every draft
 * is on one listed account, else the account picker.
 */
function reviewTarget({ accounts, totals }: HomeSummary): string {
  const pending = accounts.filter((a) => a.drafts > 0);
  const only = pending[0];
  return pending.length === 1 &&
    only?.account_id != null &&
    only.drafts === totals.drafts
    ? reviewHref(only.account_id)
    : REVIEW_ROUTE;
}

function problemsTitle(problems: readonly ProblemBlock[]): string {
  const [only] = problems;
  if (problems.length > 1 || !only) return "A few things to fix in the drafts";
  switch (only.kind) {
    case "failing-checks":
      return `${plural(only.count, "balance check")} ${only.count === 1 ? "fails" : "fail"} in the drafts`;
    case "duplicates":
      return `${plural(only.count, "possible duplicate entry", "possible duplicate entries")} in the drafts`;
  }
}

/** "HDFC Savings and ICICI Amazon Pay", or "" when no listed account applies. */
function named(accounts: readonly HomeAccount[]): string {
  return joinNames(accounts.map((account) => account.name));
}

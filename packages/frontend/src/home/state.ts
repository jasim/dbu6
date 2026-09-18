import {
  isProblem,
  postingBlocks,
  postingCheck,
  type HomeAccount,
  type HomeLedgerAccount,
  type HomeSummary,
  type ProblemBlock,
} from "dbu6-shared";
import { checkText } from "../review/posting-checks";
import { reviewHref, REVIEW_ROUTE } from "../review/routes";
import { joinNames, plural } from "../format";

/*
 * What Home says, as a pure function of the summary (PLAN.md §11 P1). In
 * precedence order: no accounts, then whatever blocks the drafts (problems
 * before categories, as `postingBlocks` marks them), then drafts ready to add,
 * then nothing imported, then new statements to import. An empty Review
 * doesn't mean the books are up to date: a statement may not have been
 * imported yet, so Home never says so.
 */

export type HomeStateId =
  | "no-accounts"
  | "nothing-imported"
  | "problems"
  | "uncategorised"
  | "ready"
  | "import-new";

export interface HomeLink {
  label: string;
  to: string;
}

export interface HomeCard {
  /** The medallion figure; absent when there is nothing to count. */
  count?: number;
  title: string;
  body?: string;
  action: HomeLink;
}

export interface HomeView {
  state: HomeStateId;
  /** The page heading; absent when there is nothing to review. */
  greeting?: string;
  card: HomeCard;
}

export function homeState(summary: HomeSummary): HomeView {
  const { accounts, totals } = summary;
  const review = reviewTarget(summary);
  const problems = postingBlocks(totals).filter(isProblem);
  const categories = postingCheck(totals, "categories");

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

  if (categories.state === "blocks") {
    const where = named(
      inLedger(accounts).filter((account) => account.uncategorised > 0),
    );
    return {
      state: "uncategorised",
      greeting: "Almost ready to add to your books",
      card: {
        count: categories.count,
        title: checkText(categories),
        body: `${
          where
            ? `They're waiting in the drafts for ${where}.`
            : "They're waiting in the drafts."
        } Nothing is added to your books until you've reviewed them.`,
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
        body: `Drop in a statement for ${where}. Nothing reaches your books until you've reviewed it.`,
        action: { label: "Import statements", to: "/import" },
      },
    };
  }

  return {
    state: "import-new",
    card: {
      title: "Import new statements",
      action: { label: "Import statements", to: "/import" },
    },
  };
}

/**
 * Where the drafts are reviewed: the account's own Review when every draft
 * is on one listed account, else the account picker.
 */
function reviewTarget({ accounts, totals }: HomeSummary): string {
  const pending = inLedger(accounts).filter((account) => account.drafts > 0);
  const [only] = pending;
  return pending.length === 1 && only.drafts === totals.drafts
    ? reviewHref(only.account_id)
    : REVIEW_ROUTE;
}

function problemsTitle(problems: readonly ProblemBlock[]): string {
  const [only] = problems;
  if (problems.length > 1 || !only) return "A few things to fix in the drafts";
  switch (only.kind) {
    case "balance-checks":
      return `${checkText(only)} in the drafts`;
    case "duplicates":
      // Home's own words for them (PLAN.md §11 P1).
      return `${plural(only.count, "possible duplicate entry", "possible duplicate entries")} in the drafts`;
  }
}

/** The listed accounts the ledger has; only they can hold drafts. */
function inLedger(accounts: readonly HomeAccount[]): HomeLedgerAccount[] {
  return accounts.filter(
    (account): account is HomeLedgerAccount => account.in_ledger,
  );
}

/** "HDFC Savings and ICICI Amazon Pay", or "" when no listed account applies. */
function named(accounts: readonly HomeAccount[]): string {
  return joinNames(accounts.map((account) => account.name));
}

import type { HomeAccount, HomeSummary } from "dbu6-shared";
import { joinNames, plural } from "../views/import-statements/format";

/*
 * What Home says, as a pure function of the summary (PLAN.md §11 P1). In
 * precedence order: no accounts, then whatever is in the drafts (problems
 * before categories, since a wrong balance usually means a wrong or missing
 * statement), then nothing imported, then up to date.
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
  /** Text links after the body, for the checks Review does not show yet. */
  links: readonly HomeLink[];
  action: HomeLink;
}

export interface HomeView {
  state: HomeStateId;
  greeting: string;
  card: HomeCard;
}

const REVIEW = "/review";

export function homeState(summary: HomeSummary): HomeView {
  const { accounts, totals } = summary;

  if (accounts.length === 0) {
    return {
      state: "no-accounts",
      greeting: "Let's set up your first account",
      card: {
        title: "Add your first account",
        body: "dbu6 imports statements from the banks and cards you set up. Each needs an account and an import preset.",
        links: [],
        action: { label: "Open accounts", to: "/accounts" },
      },
    };
  }

  if (totals.failing_checks > 0 || totals.duplicates > 0) {
    return {
      state: "problems",
      greeting: "A few things to fix first",
      card: {
        count: totals.failing_checks + totals.duplicates,
        title: problemsTitle(totals.failing_checks, totals.duplicates),
        body: "They have to be fixed before those drafts can be added to your books.",
        links: [
          ...(totals.failing_checks > 0
            ? [
                {
                  label: "See the balance checks",
                  to: "/reports/draft-balance-assertions",
                },
              ]
            : []),
          ...(totals.duplicates > 0
            ? [{ label: "See the duplicates", to: "/reports/duplicate-drafts" }]
            : []),
        ],
        action: { label: "Review the drafts", to: REVIEW },
      },
    };
  }

  if (totals.uncategorised > 0) {
    const where = named(accounts.filter((a) => a.uncategorised > 0));
    return {
      state: "uncategorised",
      greeting: "You're nearly up to date",
      card: {
        count: totals.uncategorised,
        title: `${plural(totals.uncategorised, "transaction")} ${
          totals.uncategorised === 1 ? "needs" : "need"
        } a category`,
        body: `${
          where
            ? `They're waiting in the drafts for ${where}.`
            : "They're waiting in the drafts."
        } Nothing is added to your books until you've checked them.`,
        links: [],
        action: { label: "Review transactions", to: REVIEW },
      },
    };
  }

  if (totals.drafts > 0) {
    const where = named(accounts.filter((a) => a.drafts > 0));
    return {
      state: "ready",
      greeting: "Ready to add to your books",
      card: {
        count: totals.drafts,
        title: `${plural(totals.drafts, "transaction")} ready to add`,
        body: where
          ? `The drafts for ${where} are categorised and the balances match.`
          : "The drafts are categorised and the balances match.",
        links: [],
        action: { label: "Add them to my books", to: "/views/post-drafts" },
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
        links: [],
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
      links: [],
      action: { label: "Import statements", to: "/import" },
    },
  };
}

function problemsTitle(failing: number, duplicates: number): string {
  if (failing > 0 && duplicates > 0) return "A few things to fix in the drafts";
  if (failing > 0) {
    return `${plural(failing, "balance check")} ${failing === 1 ? "fails" : "fail"} in the drafts`;
  }
  return `${plural(duplicates, "possible duplicate entry", "possible duplicate entries")} in the drafts`;
}

/** "HDFC Savings and ICICI Amazon Pay", or "" when no listed account applies. */
function named(accounts: readonly HomeAccount[]): string {
  return joinNames(accounts.map((account) => account.name));
}

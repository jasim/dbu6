import type {
  HomeAccount,
  HomeLedgerAccount,
  HomeSummary,
} from "../../shared/index";
import { reviewHref, REVIEW_ROUTE } from "../review/routes";
import { joinNames } from "../format";
import { SETUP_ROUTE, SETUP_STEP_ROUTES } from "../setup/steps";

/*
 * What Home says, as a pure function of the summary (PLAN.md §11 P1). In
 * precedence order: no accounts, then drafts waiting, then nothing imported,
 * then new statements to import. Home only says that drafts are waiting; what
 * they still need is Review's to say. An empty Review doesn't mean the books
 * are up to date: a statement may not have been imported yet, so Home never
 * says so.
 */

export type HomeStateId =
  "no-accounts" | "nothing-imported" | "drafts" | "import-new";

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
  /** The page heading; absent when the card says it all. */
  greeting?: string;
  card: HomeCard;
  /**
   * Whether the page lists the accounts under the card: not before there
   * are any, when the card's is the one thing to do.
   */
  listsAccounts: boolean;
}

export function homeState(summary: HomeSummary): HomeView {
  const { accounts, totals } = summary;

  if (accounts.length === 0) {
    return {
      state: "no-accounts",
      greeting: "Let's set up your books",
      card: {
        title: "Four steps",
        body: "A chart of accounts, your banks and cards, a statement each, then review.",
        action: { label: "Start setup", to: SETUP_ROUTE },
      },
      listsAccounts: false,
    };
  }

  if (totals.drafts > 0) {
    return {
      state: "drafts",
      card: {
        title: "There are draft entries waiting to be posted to your books",
        action: { label: "Review transactions", to: reviewTarget(summary) },
      },
      listsAccounts: true,
    };
  }

  if (!summary.any_imported) {
    const where = named(accounts);
    return {
      state: "nothing-imported",
      greeting: "Nothing imported yet",
      card: {
        title: "Import a statement for each account",
        body: where
          ? `For ${where}. You review each one before it reaches your books.`
          : undefined,
        action: {
          label: "Import your first statements",
          to: SETUP_STEP_ROUTES.statements,
        },
      },
      listsAccounts: true,
    };
  }

  return {
    state: "import-new",
    card: {
      title: "Import new statements",
      action: { label: "Import statements", to: "/import" },
    },
    listsAccounts: true,
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

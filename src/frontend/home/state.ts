import type {
  HomeAccount,
  HomeLedgerAccount,
  HomeSummary,
} from "../../shared/index";
import { ADD_OTHER_ROUTE, ADD_ROUTE, addHref } from "../add-account/state";
import { reviewHref, REVIEW_ROUTE } from "../review/routes";
import { joinNames } from "../format";

/*
 * What Home says, as a pure function of the summary (PLAN.md "Home"). In
 * precedence order: no chart, then drafts waiting, then nothing imported
 * (no bank or card yet, or only ones set up with no transactions), then new
 * statements to import. The first two open the first run: /setup's chart,
 * then /add's cards. Home only says that drafts are waiting; what they still
 * need is Review's to say. An empty Review doesn't mean the books are up to
 * date: a statement may not have been imported yet, so Home never says so.
 */

/** Card 1, the chart: first run only. */
export const SETUP_ROUTE = "/setup";

/**
 * Where a bank or card is edited or removed, and a deleted one's preset
 * goes: Settings' Banks & cards page.
 */
export const BANKS_SETTINGS_ROUTE = "/settings/banks";

/** "+ Add", beside "Your accounts": /add's cards, or C1. */
export const ADD_MENU: readonly HomeLink[] = [
  { label: "Bank or card", to: ADD_ROUTE },
  { label: "Cash, deposit, investment or loan", to: ADD_OTHER_ROUTE },
];

export type HomeStateId =
  "no-chart" | "nothing-imported" | "drafts" | "import-new";

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

  if (!summary.has_chart) {
    return {
      state: "no-chart",
      greeting: "Let's set up your books",
      card: {
        title: "Start with a chart of accounts",
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

  // A bank or card set up with no transactions yet (by an agent, or an add
  // left unfinished) is finished by dropping its statements at /add, like a
  // new one.
  if (!summary.any_imported) {
    const waiting = named(inLedger(accounts));
    return {
      state: "nothing-imported",
      greeting: "Let's set up your books",
      card: {
        title: "Add your first bank or card",
        body: waiting ? `Set up, no transactions yet: ${waiting}.` : undefined,
        action: {
          label: "Add a bank or card",
          to: addHref({ setup: true }),
        },
      },
      listsAccounts: accounts.length > 0,
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

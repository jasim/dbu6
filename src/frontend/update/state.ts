import {
  isProblem,
  postingBlocks,
  type HomeAccount,
  type HomeLedgerAccount,
  type HomeSummary,
} from "../../shared/index";
import type { StatusTone } from "../components/status-chip";
import { RECONCILIATION_DIFFERENCES_HREF } from "../reports/links";
import { ADD_OTHER_ROUTE, ADD_ROUTE, addHref } from "../add-account/state";
import { reviewHref, REVIEW_ROUTE } from "../review/routes";
import { SETUP_ROUTE } from "../setup/routes";
import { joinNames, plural } from "../format";

/*
 * What Update says, as a pure function of the summary (PLAN.md "Home");
 * Overview shows its card too until anything is posted. In
 * precedence order: no chart, then drafts waiting, then nothing imported
 * (no bank or card yet, or only ones set up with no transactions), then new
 * statements to import. The first two open the first run: /setup's chart,
 * then /add's cards. Update only says that drafts are waiting; what they
 * still need is Review's to say. An empty Review doesn't mean the books are
 * up to date: a statement may not have been imported yet, so Update never
 * says so.
 */

/**
 * Where a bank or card with no transactions yet gets its statements: /add,
 * as the first run while nothing is imported, so the card and an account's
 * "Needs a first statement" open the same run.
 */
export function statementsHref(summary: Pick<HomeSummary, "any_imported">) {
  return summary.any_imported ? ADD_ROUTE : addHref({ setup: true });
}

/** "+ Add", beside "Your accounts": /add's cards, or C1. */
export const ADD_MENU: readonly UpdateLink[] = [
  { label: "Bank or card", to: ADD_ROUTE },
  { label: "Cash, deposit, investment or loan", to: ADD_OTHER_ROUTE },
];

export type UpdateStateId =
  "no-chart" | "nothing-imported" | "drafts" | "import-new";

export interface UpdateLink {
  label: string;
  to: string;
}

export interface UpdateCard {
  /** The medallion figure; absent when there is nothing to count. */
  count?: number;
  title: string;
  body?: string;
  action: UpdateLink;
}

export interface UpdateView {
  state: UpdateStateId;
  /** The page heading: the first run's, else the page's own. */
  greeting: string;
  card: UpdateCard;
  /**
   * Whether the page lists the accounts under the card: not before there
   * are any, when the card's is the one thing to do.
   */
  listsAccounts: boolean;
}

/** The heading during the first run, on Update and on Overview. */
export const FIRST_RUN_GREETING = "Let's set up your books";

/** The heading once the first run is over. */
const UPDATE_HEADING = "Update your books";

export function updateState(summary: HomeSummary): UpdateView {
  const { accounts, totals } = summary;

  if (!summary.has_chart) {
    return {
      state: "no-chart",
      greeting: FIRST_RUN_GREETING,
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
      greeting: UPDATE_HEADING,
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
      greeting: FIRST_RUN_GREETING,
      card: {
        title: "Add your first bank or card",
        body: waiting ? `Set up, no transactions yet: ${waiting}.` : undefined,
        action: { label: "Add a bank or card", to: statementsHref(summary) },
      },
      listsAccounts: accounts.length > 0,
    };
  }

  return {
    state: "import-new",
    greeting: UPDATE_HEADING,
    card: {
      title: "Import new statements",
      action: { label: "Import statements", to: "/import" },
    },
    listsAccounts: true,
  };
}

/**
 * What waits on the account, and where to see it; nothing when nothing does.
 * Problems in its drafts come first, since Review shows them; then books that
 * miss a statement balance, as an entry changed after its statement was
 * added; then drafts waiting; then an institution with no parser, whose
 * statements can't be imported until dropping them at /add teaches dbu6
 * their format.
 */
export function accountStatus(
  account: HomeAccount,
  statementsTo: string,
): {
  tone: StatusTone;
  label: string;
  to?: string;
} | null {
  if (!account.in_ledger) {
    return { tone: "problem", label: "Account deleted" };
  }
  const review = reviewHref(account.account_id);
  if (postingBlocks(account).some(isProblem)) {
    return { tone: "problem", label: "Problems in drafts", to: review };
  }
  if (account.statement_differences > 0) {
    return {
      tone: "problem",
      label: "Doesn't match statement",
      to: RECONCILIATION_DIFFERENCES_HREF,
    };
  }
  if (account.drafts > 0) {
    return {
      tone: "attention",
      label: `${plural(account.drafts, "draft")} waiting`,
      to: review,
    };
  }
  if (!account.has_parser) {
    return {
      tone: "attention",
      label: "Needs a first statement",
      to: statementsTo,
    };
  }
  return null;
}

/**
 * How many accounts Update shows something waiting on, by the rule its rows
 * follow: the count on its sidebar item and Overview's status line. Zero
 * when none.
 */
export function waitingInUpdate(summary: HomeSummary): number {
  const to = statementsHref(summary);
  return summary.accounts.filter(
    (account) => accountStatus(account, to) !== null,
  ).length;
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

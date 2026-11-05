import { Temporal } from "@sapporta/shared/temporal";
import {
  type HomeAccount,
  type HomeLedgerAccount,
  type HomeSummary,
} from "../../shared/index";
import type { StatusTone } from "../components/status-chip";
import { addHref } from "../add-account/state";
import { reviewHref, REVIEW_ROUTE } from "../review/routes";
import { SETUP_ROUTE } from "../setup/routes";
import { joinNames } from "../format";
import { UPDATE_DROP_HREF } from "./routes";

/*
 * What Update says, as a pure function of the summary;
 * Overview shows its card too until anything is posted. In
 * precedence order: no chart, then drafts waiting, then nothing imported
 * (no bank or card yet, or only ones set up with no transactions), then new
 * statements to import. Each but drafts waiting is "Do my books": drop every
 * statement for a coding agent's run, a new bank or card's too, with a small
 * link to doing it by hand. Drafts waiting has its card, and the drop under
 * it with the same link. By hand is /setup's chart before there is one,
 * then /add's cards while nothing is imported, and /import after. Drafts
 * waiting keeps /add's until anything beside opening balances is posted
 * (`posted`), since /import can't add
 * the bank or card a first run may still be missing. An account that needs
 * its first statement leads to the drop on the page, `/update#drop`, since a
 * run sets up a format it hasn't read. Update's own page lists what waits on
 * the books, each account's drafts, in a section of its own above the
 * statements to upload (`draftsToReview`); which drafts need what is Review's
 * to say. An empty Review doesn't
 * mean the books are up to date: a statement may not have been imported
 * yet, so Update never says so.
 */

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
  /** The drop under the card's link to doing it by hand. */
  byHand: UpdateLink;
}

/**
 * Adding a bank or card by hand in the first run: /add's cards, as the
 * first run, beside the drop as a small link.
 */
export const FIRST_RUN_BY_HAND: UpdateLink = {
  label: "Add a bank or card",
  to: addHref({ setup: true }),
};

/**
 * Importing by hand once the first run is over: /import, beside the drop,
 * as a small link.
 */
export const GUIDED_IMPORT: UpdateLink = {
  label: "Import statements, guided",
  to: "/import",
};

/**
 * Drop every statement for a coding agent's run (`DoMyBooks`), or do it by
 * hand.
 */
export interface RunCard {
  kind: "do-my-books";
  body?: string;
  byHand: UpdateLink;
}

/**
 * What to drop on the first run, before any bank or card is set up: the one
 * choice the user makes is how far back the books start.
 */
export const WHAT_TO_BRING =
  "Add statements for each of your bank accounts and cards. Your books start from the earliest month you add, so go back as far as you want them to cover.";

export interface UpdateView {
  state: UpdateStateId;
  /** The page heading: the first run's, else the page's own. */
  greeting: string;
  card: UpdateCard | RunCard;
  /**
   * Whether nothing is imported yet: the page shows only the greeting, and
   * the drop says which coding agent will read the statements.
   */
  firstRun: boolean;
  /**
   * Whether the page lists the accounts under the card: not before there
   * are any, when the card's is the one thing to do.
   */
  listsAccounts: boolean;
}

/** The heading during the first run, on Update and on Overview. */
export const FIRST_RUN_GREETING = "Set up your books";

/** The heading once the first run is over. */
const UPDATE_HEADING = "Update your books";

export function updateState(summary: HomeSummary): UpdateView {
  const { accounts, totals } = summary;

  if (!summary.has_chart) {
    return {
      state: "no-chart",
      greeting: FIRST_RUN_GREETING,
      card: {
        kind: "do-my-books",
        body: WHAT_TO_BRING,
        byHand: {
          label: "Or, Set up the chart of accounts manually",
          to: SETUP_ROUTE,
        },
      },
      firstRun: true,
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
        byHand: summary.posted ? GUIDED_IMPORT : FIRST_RUN_BY_HAND,
      },
      firstRun: false,
      listsAccounts: true,
    };
  }

  // A bank or card set up with no transactions yet (by an agent, or an add
  // left unfinished) is finished by dropping its statements, like a new one.
  if (!summary.any_imported) {
    const waiting = named(inLedger(accounts));
    return {
      state: "nothing-imported",
      greeting: FIRST_RUN_GREETING,
      card: {
        kind: "do-my-books",
        body: waiting
          ? `Set up, no transactions yet: ${waiting}.`
          : WHAT_TO_BRING,
        byHand: FIRST_RUN_BY_HAND,
      },
      firstRun: true,
      listsAccounts: accounts.length > 0,
    };
  }

  return {
    state: "import-new",
    greeting: UPDATE_HEADING,
    card: { kind: "do-my-books", byHand: GUIDED_IMPORT },
    firstRun: false,
    listsAccounts: true,
  };
}

/**
 * The month the account's next statements start, "2026-10": the month of
 * the day after its statements end, posted or in the drafts. Only the month,
 * so the user downloads whole months and the import skips what it has. Null
 * before any statement, when every statement it has is wanted.
 */
export function statementsNeededFrom(
  account: HomeLedgerAccount,
): string | null {
  if (account.statements_until === null) return null;
  return Temporal.PlainDate.from(account.statements_until)
    .add({ days: 1 })
    .toPlainYearMonth()
    .toString();
}

/**
 * What the download list says beside an account; nothing when its
 * statements import as usual. An account deleted from the ledger first;
 * then an institution with no parser, whose statements can't be imported
 * until a run reads one: the drop on Update. What waits in its drafts or
 * its posted books is the drafts section's (`booksWaiting`).
 */
export function statementStatus(account: HomeAccount): {
  tone: StatusTone;
  label: string;
  to?: string;
} | null {
  if (!account.in_ledger) {
    return { tone: "problem", label: "Account deleted" };
  }
  if (!account.has_parser) {
    return {
      tone: "attention",
      label: "Needs a first statement",
      to: UPDATE_DROP_HREF,
    };
  }
  return null;
}

/**
 * One account in "Drafts to review": its drafts, and the posted statement
 * balances its books miss, as an entry changed after its statement was
 * added. Which drafts are in a problem is Review's to say.
 */
export interface BooksWaiting {
  account_id: number;
  name: string;
  /** The account's own Review. */
  review: string;
  drafts: number;
  differences: number;
}

/** What waits on the account's books; null when nothing does. */
export function booksWaiting(account: HomeAccount): BooksWaiting | null {
  if (!account.in_ledger) return null;
  if (account.drafts === 0 && account.statement_differences === 0) {
    return null;
  }
  return {
    account_id: account.account_id,
    name: account.name,
    review: reviewHref(account.account_id),
    drafts: account.drafts,
    differences: account.statement_differences,
  };
}

/**
 * Update's "Drafts to review": the listed accounts something waits on in
 * the books, and where to review the drafts while there are any, unlisted
 * accounts' too. Null when nothing waits.
 */
export interface DraftsToReview {
  accounts: BooksWaiting[];
  /** Absent when only posted balances miss their statements. */
  review?: UpdateLink;
  /** Whether any account's books miss a statement balance. */
  differences: boolean;
}

export function draftsToReview(summary: HomeSummary): DraftsToReview | null {
  const accounts = summary.accounts
    .map(booksWaiting)
    .filter((waiting): waiting is BooksWaiting => waiting !== null);
  if (accounts.length === 0 && summary.totals.drafts === 0) return null;
  return {
    accounts,
    review:
      summary.totals.drafts > 0
        ? { label: "Review drafts", to: reviewTarget(summary) }
        : undefined,
    differences: accounts.some((waiting) => waiting.differences > 0),
  };
}

/**
 * How many accounts Update shows something waiting on, in the drafts
 * section or beside the download list: the count on its sidebar item and
 * Overview's status line. Zero when none.
 */
export function waitingInUpdate(summary: HomeSummary): number {
  return summary.accounts.filter(
    (account) =>
      statementStatus(account) !== null || booksWaiting(account) !== null,
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

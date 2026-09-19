import type {
  HomeAccount,
  HomeLedgerAccount,
  HomeSummary,
} from "dbu6-shared";
import { reviewHref, REVIEW_ROUTE } from "../review/routes";
import { joinNames } from "../format";

/*
 * What Home says, as a pure function of the summary (PLAN.md §11 P1). In
 * precedence order: no accounts, then drafts waiting, then nothing imported,
 * then new statements to import. Home only says that drafts are waiting; what
 * they still need is Review's to say. An empty Review doesn't mean the books
 * are up to date: a statement may not have been imported yet, so Home never
 * says so.
 */

export type HomeStateId =
  | "no-accounts"
  | "nothing-imported"
  | "drafts"
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
  /** The page heading; absent when the card says it all. */
  greeting?: string;
  card: HomeCard;
}

export function homeState(summary: HomeSummary): HomeView {
  const { accounts, totals } = summary;

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

  if (totals.drafts > 0) {
    return {
      state: "drafts",
      card: {
        title: "There are draft entries waiting to be posted to your books",
        action: { label: "Review transactions", to: reviewTarget(summary) },
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

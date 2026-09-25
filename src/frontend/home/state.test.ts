import { describe, expect, it } from "vitest";
import type {
  DraftCounts,
  HomeAccount,
  HomeLedgerAccount,
  HomeSummary,
} from "../../shared/index";
import { ADD_MENU, homeState, statementsHref } from "./state";

function account(
  overrides: Partial<HomeLedgerAccount> = {},
): HomeLedgerAccount {
  return {
    in_ledger: true,
    account_id: 2,
    path: "Sample Savings",
    name: "Sample Savings",
    kind: "bank",
    has_parser: true,
    checkpoint: { date: "2026-08-31", balance: 250000 },
    statement_differences: 0,
    drafts: 0,
    uncategorised: 0,
    duplicates: 0,
    balance_checks: 0,
    failing_checks: 0,
    ...overrides,
  };
}

// A preset account whose ledger account was deleted.
const deleted: HomeAccount = {
  in_ledger: false,
  account_id: 9,
  name: "Sample Deleted",
  kind: "bank",
  has_parser: true,
};

function summary(
  accounts: HomeAccount[],
  overrides: Partial<HomeSummary> = {},
): HomeSummary {
  const listed = accounts.filter((a): a is HomeLedgerAccount => a.in_ledger);
  return {
    has_chart: true,
    accounts,
    totals: {
      drafts: sum(listed, "drafts"),
      uncategorised: sum(listed, "uncategorised"),
      duplicates: sum(listed, "duplicates"),
      balance_checks: sum(listed, "balance_checks"),
      failing_checks: sum(listed, "failing_checks"),
    },
    any_imported: listed.some((a) => a.checkpoint !== null),
    ...overrides,
  };
}

function sum(accounts: HomeLedgerAccount[], key: keyof DraftCounts): number {
  return accounts.reduce((total, a) => total + a[key], 0);
}

describe("homeState", () => {
  it("starts setup with the chart when the books have none", () => {
    const view = homeState(summary([], { has_chart: false }));
    expect(view.state).toBe("no-chart");
    expect(view.greeting).toBe("Let's set up your books");
    expect(view.card).toEqual({
      title: "Start with a chart of accounts",
      action: { label: "Start setup", to: "/setup" },
    });
    // The card is the one thing to do: no empty list of accounts below it.
    expect(view.listsAccounts).toBe(false);
  });

  it("asks for the first bank or card, on the first run, once there is a chart", () => {
    const view = homeState(summary([]));
    expect(view.state).toBe("nothing-imported");
    expect(view.greeting).toBe("Let's set up your books");
    expect(view.card).toEqual({
      title: "Add your first bank or card",
      action: { label: "Add a bank or card", to: "/add?run=setup" },
    });
    expect(view.listsAccounts).toBe(false);
  });

  it("names the banks and cards set up with no transactions yet", () => {
    // Set up by an agent, or an add left unfinished: /add finishes them.
    const view = homeState(
      summary([
        account({ checkpoint: null }),
        account({
          account_id: 1,
          path: "Sample Card",
          name: "Sample Card",
          kind: "card",
          checkpoint: null,
        }),
        deleted,
      ]),
    );
    expect(view.state).toBe("nothing-imported");
    expect(view.listsAccounts).toBe(true);
    // A preset whose account the books deleted isn't one to finish.
    expect(view.card.body).toBe(
      "Set up, no transactions yet: Sample Savings and Sample Card.",
    );
    expect(view.card.action.to).toBe("/add?run=setup");
  });

  it("says drafts are waiting, whatever they still need", () => {
    const view = homeState(
      summary([account({ drafts: 12, uncategorised: 5, failing_checks: 2 })]),
    );
    expect(view.state).toBe("drafts");
    expect(view.greeting).toBeUndefined();
    expect(view.card).toEqual({
      title: "There are draft entries waiting to be posted to your books",
      action: { label: "Review transactions", to: "/review/2" },
    });
  });

  it("sends drafts on several accounts to the account picker", () => {
    const view = homeState(
      summary([
        account({ drafts: 21 }),
        account({
          account_id: 1,
          path: "Sample Card",
          name: "Sample Card",
          kind: "card",
          drafts: 4,
        }),
      ]),
    );
    expect(view.card.action.to).toBe("/review");
  });

  it("sends drafts on unlisted accounts to the account picker", () => {
    const view = homeState(
      summary([account()], {
        totals: {
          drafts: 3,
          uncategorised: 0,
          duplicates: 0,
          balance_checks: 0,
          failing_checks: 0,
        },
      }),
    );
    expect(view.state).toBe("drafts");
    expect(view.card.action.to).toBe("/review");
  });

  it("gives the only account with drafts its own Review", () => {
    // An account deleted from the ledger holds no drafts.
    const view = homeState(summary([account({ drafts: 21 }), deleted]));
    expect(view.card.action.to).toBe("/review/2");
  });

  it("asks for new statements, without claiming up to date, when nothing is pending", () => {
    const view = homeState(summary([account()]));
    expect(view.state).toBe("import-new");
    expect(view.greeting).toBeUndefined();
    expect(view.card.count).toBeUndefined();
    expect(view.card.title).toBe("Import new statements");
    expect(view.card.body).toBeUndefined();
    expect(view.card.action).toEqual({
      label: "Import statements",
      to: "/import",
    });
  });

  it("sends a bank or card's first statements to the first run until one is imported", () => {
    expect(statementsHref({ any_imported: false })).toBe("/add?run=setup");
    expect(statementsHref({ any_imported: true })).toBe("/add");
  });

  it("adds a bank or card through /add, and anything else through C1", () => {
    expect(ADD_MENU).toEqual([
      { label: "Bank or card", to: "/add" },
      { label: "Cash, deposit, investment or loan", to: "/add/other" },
    ]);
  });
});

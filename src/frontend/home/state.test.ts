import { describe, expect, it } from "vitest";
import type {
  DraftCounts,
  HomeAccount,
  HomeLedgerAccount,
  HomeSummary,
} from "../../shared/index";
import { homeState } from "./state";

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
    accounts,
    totals: {
      drafts: sum(listed, "drafts"),
      uncategorised: sum(listed, "uncategorised"),
      duplicates: sum(listed, "duplicates"),
      balance_checks: sum(listed, "balance_checks"),
      failing_checks: sum(listed, "failing_checks"),
    },
    has_journals: listed.some((a) => a.checkpoint !== null),
    ...overrides,
  };
}

function sum(accounts: HomeLedgerAccount[], key: keyof DraftCounts): number {
  return accounts.reduce((total, a) => total + a[key], 0);
}

describe("homeState", () => {
  it("asks for an account when no preset lists one", () => {
    const view = homeState(summary([]));
    expect(view.state).toBe("no-accounts");
    expect(view.greeting).toBe("Let's set up your books");
    expect(view.card.count).toBeUndefined();
    expect(view.card.body).toBe(
      "Four steps: a chart of accounts, your banks and cards, a statement each, then review.",
    );
    expect(view.card.action).toEqual({
      label: "Set up your books",
      to: "/setup",
    });
  });

  it("asks for the first statement when nothing has been imported", () => {
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
      ]),
    );
    expect(view.state).toBe("nothing-imported");
    expect(view.card.body).toContain("For Sample Savings and Sample Card.");
    expect(view.card.action).toEqual({
      label: "Import your first statements",
      to: "/setup/statements",
    });
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
});

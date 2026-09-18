import { describe, expect, it } from "vitest";
import type {
  DraftCounts,
  HomeAccount,
  HomeLedgerAccount,
  HomeSummary,
} from "dbu6-shared";
import { homeState } from "./state";

function account(
  overrides: Partial<HomeLedgerAccount> = {},
): HomeLedgerAccount {
  return {
    in_ledger: true,
    account_id: 2,
    path: "assets:bank:sample-savings",
    name: "Sample Savings",
    kind: "bank",
    checkpoint: { date: "2026-08-31", balance: 250000 },
    drafts: 0,
    uncategorised: 0,
    duplicates: 0,
    balance_checks: 0,
    failing_checks: 0,
    ...overrides,
  };
}

const missing: HomeAccount = {
  in_ledger: false,
  path: "assets:bank:missing-050505",
  name: "Not Yet Added",
  kind: "bank",
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
  it("asks for an account when no preset names one", () => {
    const view = homeState(summary([]));
    expect(view.state).toBe("no-accounts");
    expect(view.greeting).toBe("Let's set up your first account");
    expect(view.card.count).toBeUndefined();
    expect(view.card.action).toEqual({
      label: "Open accounts",
      to: "/accounts",
    });
  });

  it("asks for the first statement when nothing has been imported", () => {
    const view = homeState(
      summary([
        account({ checkpoint: null }),
        account({
          account_id: 1,
          path: "liabilities:cards:sample-card",
          name: "Sample Card",
          kind: "card",
          checkpoint: null,
        }),
      ]),
    );
    expect(view.state).toBe("nothing-imported");
    expect(view.card.body).toContain(
      "Drop in a statement for Sample Savings and Sample Card.",
    );
    expect(view.card.action.to).toBe("/import");
  });

  it("puts problems in the drafts before categories", () => {
    const view = homeState(
      summary([
        account({
          drafts: 12,
          uncategorised: 5,
          failing_checks: 2,
          duplicates: 1,
        }),
      ]),
    );
    expect(view.state).toBe("problems");
    expect(view.greeting).toBe("A few things to fix first");
    expect(view.card.count).toBe(3);
    expect(view.card.title).toBe("A few things to fix in the drafts");
    expect(view.card.action).toEqual({
      label: "Review the drafts",
      to: "/review/2",
    });
  });

  it("names the one kind of problem when there is only one", () => {
    expect(
      homeState(summary([account({ drafts: 3, failing_checks: 1 })])).card
        .title,
    ).toBe("1 balance check fails in the drafts");
    const duplicates = homeState(
      summary([account({ drafts: 3, duplicates: 2 })]),
    ).card;
    expect(duplicates.title).toBe("2 possible duplicate entries in the drafts");
  });

  it("counts the drafts needing a category and says where they are", () => {
    const view = homeState(
      summary([
        account({ drafts: 21, uncategorised: 12 }),
        account({
          account_id: 1,
          path: "liabilities:cards:sample-card",
          name: "Sample Card",
          kind: "card",
          drafts: 4,
        }),
      ]),
    );
    expect(view.state).toBe("uncategorised");
    expect(view.card.count).toBe(12);
    expect(view.card.title).toBe("12 transactions need a category");
    expect(view.card.body).toBe(
      "They're waiting in the drafts for Sample Savings. Nothing is added to your books until you've reviewed them.",
    );
    // Drafts on two accounts: the picker, not one account's Review.
    expect(view.card.action).toEqual({
      label: "Review transactions",
      to: "/review",
    });
  });

  it("does not name accounts when the drafts sit on unlisted ones", () => {
    const view = homeState(
      summary([account()], {
        totals: {
          drafts: 3,
          uncategorised: 1,
          duplicates: 0,
          balance_checks: 0,
          failing_checks: 0,
        },
      }),
    );
    expect(view.state).toBe("uncategorised");
    expect(view.card.title).toBe("1 transaction needs a category");
    expect(view.card.body).toMatch(/^They're waiting in the drafts\. /);
    expect(view.card.action.to).toBe("/review");
  });

  it("offers to post when every draft is categorised and clean", () => {
    // An account the ledger doesn't have yet holds no drafts, so the only
    // account with drafts still gets its own Review.
    const view = homeState(summary([account({ drafts: 21 }), missing]));
    expect(view.state).toBe("ready");
    expect(view.card.count).toBe(21);
    expect(view.card.body).toBe("The entries are ready for posting.");
    expect(view.card.action).toEqual({
      label: "Add them to my books",
      to: "/review/2",
    });
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

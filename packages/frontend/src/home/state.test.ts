import { describe, expect, it } from "vitest";
import type { HomeAccount, HomeSummary } from "dbu6-shared";
import { homeState } from "./state";

function account(overrides: Partial<HomeAccount> = {}): HomeAccount {
  return {
    account_id: 2,
    path: "assets:bank:sample-savings",
    name: "Sample Savings",
    kind: "bank",
    checked_to: "2026-08-31",
    checked_balance: 250000,
    drafts: 0,
    uncategorised: 0,
    duplicates: 0,
    failing_checks: 0,
    ...overrides,
  };
}

function summary(
  accounts: HomeAccount[],
  overrides: Partial<HomeSummary> = {},
): HomeSummary {
  return {
    accounts,
    totals: {
      drafts: sum(accounts, "drafts"),
      uncategorised: sum(accounts, "uncategorised"),
      duplicates: sum(accounts, "duplicates"),
      failing_checks: sum(accounts, "failing_checks"),
    },
    has_journals: accounts.some((a) => a.checked_to !== null),
    ...overrides,
  };
}

function sum(accounts: HomeAccount[], key: keyof HomeAccount): number {
  return accounts.reduce((total, a) => total + Number(a[key]), 0);
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
        account({ checked_to: null, checked_balance: null }),
        account({
          account_id: 1,
          path: "liabilities:cards:sample-card",
          name: "Sample Card",
          kind: "card",
          checked_to: null,
          checked_balance: null,
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
    expect(view.card.links.map((l) => l.to)).toEqual([
      "/reports/draft-balance-assertions",
      "/reports/duplicate-drafts",
    ]);
    expect(view.card.action.to).toBe("/review");
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
    expect(duplicates.links).toEqual([
      { label: "See the duplicates", to: "/reports/duplicate-drafts" },
    ]);
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
      "They're waiting in the drafts for Sample Savings. Nothing is added to your books until you've checked them.",
    );
  });

  it("does not name accounts when the drafts sit on unlisted ones", () => {
    const view = homeState(
      summary([account()], {
        totals: {
          drafts: 3,
          uncategorised: 1,
          duplicates: 0,
          failing_checks: 0,
        },
      }),
    );
    expect(view.state).toBe("uncategorised");
    expect(view.card.title).toBe("1 transaction needs a category");
    expect(view.card.body).toMatch(/^They're waiting in the drafts\. /);
  });

  it("offers to post when every draft is categorised and clean", () => {
    const view = homeState(summary([account({ drafts: 21 })]));
    expect(view.state).toBe("ready");
    expect(view.card.count).toBe(21);
    expect(view.card.body).toBe(
      "The drafts for Sample Savings are categorised and the balances match.",
    );
    expect(view.card.action.to).toBe("/views/post-drafts");
  });

  it("says so when nothing is pending", () => {
    const view = homeState(summary([account()]));
    expect(view.state).toBe("up-to-date");
    expect(view.greeting).toBe("You're up to date");
    expect(view.card.count).toBeUndefined();
    expect(view.card.action).toEqual({
      label: "Import statements",
      to: "/import",
    });
  });
});

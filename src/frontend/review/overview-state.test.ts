import { describe, expect, it } from "vitest";
import type { ReviewAccount, ReviewAccountDetail } from "../../shared/index";
import { arrivalNotice, overviewView, postedView } from "./overview-state";

function detail(
  account: Partial<ReviewAccount> = {},
  overrides: Partial<ReviewAccountDetail> = {},
): ReviewAccountDetail {
  return {
    account: {
      account_id: 2,
      path: "Sample Savings",
      parent_path: null,
      name: "Sample Savings",
      kind: "bank",
      drafts: 21,
      uncategorised: 0,
      duplicates: 0,
      balance_checks: 13,
      failing_checks: 0,
      relies_on: [],
      draft_span: { first_date: "2026-09-01", last_date: "2026-09-13" },
      rule_requests: 0,
      ...account,
    },
    checkpoint: { date: "2026-08-31", balance: 250000 },
    has_opening_entry: true,
    no_starting_balance: [],
    closing: { date: "2026-09-13", balance: 330000 },
    failing: [],
    duplicates: [],
    other_accounts: [],
    ...overrides,
  };
}

const failing = (date: string, draft_id: number) => ({
  date,
  draft_id,
  running_balance: 340000,
  assertion: 330000,
  diff: 10000,
});

describe("overviewView", () => {
  it("is ready when every check passes, and lists them as passed", () => {
    const view = overviewView(detail());

    expect(view.status).toBe("21 transactions ready to add");
    expect(view.ready).toBe(true);
    expect(view.problems).toEqual([]);
    expect(view.passed.map((row) => [row.tone, row.text])).toEqual([
      ["ok", "Accounts: all 21 transactions are categorized"],
      ["ok", "No duplicate entries found"],
      [
        "ok",
        "Balance checks: statement balance and our computed balance match",
      ],
    ]);
    expect(view.fix).toBeUndefined();
    expect(view.facts).toEqual([
      { label: "Dates", value: "1–13 Sep" },
      { label: "Balance on 13 Sep", value: "3,30,000.00" },
    ]);
  });

  it("puts what blocks the add first, with the screen that fixes it", () => {
    const view = overviewView(detail({ uncategorised: 12 }));

    expect(view.status).toBe("21 transactions in drafts");
    expect(view.ready).toBe(false);
    expect(view.fix).toBe("problems");
    expect(view.problems).toEqual([
      {
        check: "categorization",
        tone: "attention",
        text: "12 transactions need an account",
        link: {
          label: "Categorize in Drafts",
          to: "/review/2/drafts?filter%5Baccount_id%5D%5Bis%5D=null",
        },
      },
    ]);
    expect(view.passed.map((row) => row.check)).toEqual([
      "duplicates",
      "balance-checks",
    ]);
  });

  it("lists several problems in tab order", () => {
    const view = overviewView(
      detail(
        { uncategorised: 1, duplicates: 2, failing_checks: 3 },
        {
          failing: [
            failing("2026-09-05", 7),
            failing("2026-09-06", 8),
            failing("2026-09-09", 9),
          ],
        },
      ),
    );

    expect(
      view.problems.map((row) => [row.tone, row.text, row.link.label]),
    ).toEqual([
      ["attention", "1 transaction needs an account", "Categorize in Drafts"],
      ["problem", "2 possible duplicates", "Compare duplicates"],
      [
        "problem",
        "3 balance checks fail, the first on 5 Sep",
        "Open balance checks",
      ],
    ]);
    expect(view.passed).toEqual([]);
  });

  it("goes in with the account whose drafts the balance checks count, on Add all", () => {
    const view = overviewView(
      detail({ relies_on: [{ account_id: 7, name: "Sample Bank" }] }),
    );

    expect(view.status).toBe("21 transactions in drafts");
    expect(view.ready).toBe(false);
    // Adding them together is the person's; the agent has nothing to fix.
    expect(view.fix).toBeUndefined();
    expect(view.problems).toEqual([
      {
        check: "relies-on",
        tone: "attention",
        text: "These balance checks count Sample Bank's drafts. Add both together on Review.",
        link: { label: "Go to Review", to: "/review" },
      },
    ]);
  });

  it("doesn't block drafts that carry no balance checks", () => {
    const view = overviewView(
      detail(
        {
          drafts: 1,
          balance_checks: 0,
          draft_span: { first_date: "2026-09-13", last_date: "2026-09-13" },
        },
        { closing: null },
      ),
    );

    expect(view.status).toBe("1 transaction ready to add");
    expect(view.passed.map((row) => [row.tone, row.text])).toEqual([
      ["ok", "Accounts: the transaction is categorized"],
      ["ok", "No duplicate entries found"],
      [
        "waiting",
        "No balance assertions in these drafts, so no balance checks run",
      ],
    ]);
    expect(view.facts).toEqual([{ label: "Dates", value: "13 Sep" }]);
  });

  it("notes what the import categorized, only after one", () => {
    const counts = { drafts: 21, categorized: 9 };
    expect(
      overviewView(detail({ uncategorised: 12 }), counts).problems[0].note,
    ).toBe("9 of 21 categorized automatically");
    expect(overviewView(detail(), counts).passed[0].note).toBe(
      "9 of 21 categorized automatically",
    );
    expect(
      overviewView(detail({ uncategorised: 12 })).problems[0].note,
    ).toBeUndefined();
  });
});

describe("Fix these on the Overview", () => {
  it("has the agent fix rule requests too, beside the add, which they don't block", () => {
    const view = overviewView(detail({ rule_requests: 2 }));
    expect(view.fix).toBe("actions");
    expect(view.ready).toBe(true);
  });
});

describe("postedView", () => {
  it("says what was added and offers the next account by name", () => {
    const view = postedView(detail(), 21, [
      { account_id: 1, name: "Sample Card", drafts: 4 },
      { account_id: 3, name: "Sample Wallet", drafts: 2 },
    ]);

    expect(view.status).toBe("21 transactions added to your books");
    expect(view.facts).toEqual([
      { label: "Dates", value: "1–13 Sep" },
      { label: "Balance on 13 Sep", value: "3,30,000.00" },
    ]);
    expect(view.next).toEqual({ label: "Review Sample Card", to: "/review/1" });
    expect(view.also).toEqual({ label: "All accounts", to: "/review" });
  });

  it("sends the user to Overview when no account has drafts left", () => {
    const view = postedView(detail({}, { closing: null }), 1, []);

    expect(view.status).toBe("1 transaction added to your books");
    expect(view.next).toEqual({ label: "See your money", to: "/" });
    expect(view.also).toEqual({
      label: "Update your books",
      to: "/update",
    });
  });

  it("offers Review's Add all while other accounts are ready to add", () => {
    const view = postedView(
      detail(),
      21,
      [
        { account_id: 1, name: "Sample Card", drafts: 4 },
        { account_id: 3, name: "Sample Wallet", drafts: 2 },
      ],
      { readyOthers: 2 },
    );

    expect(view.next).toEqual({ label: "Add 2 ready accounts", to: "/review" });
    expect(view.also).toEqual({ label: "Review Sample Card", to: "/review/1" });
  });

  it("carries the first run to the next account and to the picker", () => {
    const view = postedView(
      detail(),
      21,
      [{ account_id: 1, name: "Sample Card", drafts: 4 }],
      { setup: true },
    );

    expect(view.next).toEqual({
      label: "Review Sample Card",
      to: "/review/1?run=setup",
    });
    expect(view.also).toEqual({
      label: "All accounts",
      to: "/review?run=setup",
    });
  });

  it("ends the first run once nothing is left to post, with no net worth", () => {
    const view = postedView(detail(), 21, [], { setup: true });

    expect(view.status).toBe("21 transactions added. Your books are set up.");
    expect(view.next).toEqual({ label: "See your money", to: "/" });
    expect(view.also).toBeUndefined();
  });
});

describe("the notice after an import", () => {
  const counts = { drafts: 21, categorized: 9 };

  it("hands what is left to the agent, then the add", () => {
    const notice = arrivalNotice(detail({ uncategorised: 12 }), counts);
    expect(notice).toEqual({
      title: "21 transactions imported",
      facts: [
        { label: "Categorized automatically", value: "9" },
        { label: "Need an account", value: "12" },
      ],
      next: "Next: hand what's left to your agent, then add them to your books.",
      action: "fix",
    });
  });

  it("names the problems, and hands them to the agent", () => {
    const notice = arrivalNotice(
      detail(
        { duplicates: 2, failing_checks: 1 },
        {
          failing: [failing("2026-09-05", 7)],
        },
      ),
      { drafts: 21, categorized: 21 },
    );
    expect(notice.facts.map((fact) => fact.label)).toEqual([
      "Categorized automatically",
      "Need an account",
      "Possible duplicates",
      "Balance checks failing",
    ]);
    expect(notice.action).toBe("fix");
  });

  it("sends the user to Review's Add all for drafts that go in with another account's, which no agent can do", () => {
    const notice = arrivalNotice(
      detail({ relies_on: [{ account_id: 1, name: "Sample Card" }] }),
      { drafts: 21, categorized: 21 },
    );
    expect(notice.next).toBe(
      "Next: add them with Sample Card on Review's Add all, once it is ready. These balance checks count its drafts.",
    );
    expect(notice.action).toEqual({ label: "Go to Review", to: "/review" });
  });

  it("leaves the add to the Overview when nothing blocks it", () => {
    const notice = arrivalNotice(detail(), { drafts: 21, categorized: 21 });
    expect(notice.next).toBe("Next: add them to your books.");
    expect(notice.action).toBeUndefined();
  });
});

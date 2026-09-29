import { describe, expect, it } from "vitest";
import type { ReviewAccount, ReviewAccountDetail } from "../../shared/index";
import {
  arrivalNotice,
  overviewView,
  phraseText,
  postedView,
} from "./overview-state";

function detail(
  account: Partial<ReviewAccount> = {},
  overrides: Partial<ReviewAccountDetail> = {},
): ReviewAccountDetail {
  return {
    account: {
      account_id: 2,
      path: "Sample Savings",
      name: "Sample Savings",
      kind: "bank",
      drafts: 21,
      uncategorised: 0,
      duplicates: 0,
      balance_checks: 13,
      failing_checks: 0,
      draft_span: { first_date: "2026-09-01", last_date: "2026-09-13" },
      ...account,
    },
    checkpoint: { date: "2026-08-31", balance: 250000 },
    has_opening_entry: true,
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
  it("is ready when every check passes, and says what posting does", () => {
    const view = overviewView(detail());

    expect(view.verdict).toBe("Ready to add to your books");
    expect(view.waiting).toBeUndefined();
    expect(view.button).toBe("Add to my books");
    expect(view.checks.map((row) => [row.tone, row.text])).toEqual([
      ["ok", "All 21 transactions go to an account"],
      ["ok", "No possible duplicates"],
      ["ok", "Your books agree with the bank"],
    ]);
    expect(view.checks.every((row) => row.link === undefined)).toBe(true);
    expect(view.posting).toEqual([
      { label: "Transactions", value: "21" },
      { label: "Dates", value: "1–13 Sep" },
      { label: "Balance on 13 Sep", value: "3,30,000.00" },
    ]);
  });

  it("is not ready while a check fails, and waits for the one reason", () => {
    const view = overviewView(detail({ uncategorised: 12 }));

    expect(view.verdict).toBe("Not ready to add yet");
    expect(view.posting).toBeUndefined();
    expect(view.waiting).toBe("12 still need an account");
    expect(view.checks[0]).toEqual({
      check: "categorization",
      tone: "attention",
      text: "12 transactions need an account",
      link: {
        label: "See them in Drafts",
        to: "/review/2/drafts?filter%5Baccount_id%5D%5Bis%5D=null",
      },
    });
  });

  it("joins several reasons in tab order", () => {
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

    expect(view.waiting).toBe(
      "1 still needs an account · 2 possible duplicates · 3 balance checks fail",
    );
    expect(
      view.checks.map((row) => [row.tone, row.text, row.link?.to]),
    ).toEqual([
      [
        "attention",
        "1 transaction needs an account",
        "/review/2/drafts?filter%5Baccount_id%5D%5Bis%5D=null",
      ],
      ["problem", "2 possible duplicates", "/review/2/duplicates"],
      [
        "problem",
        "3 balance checks fail, the first on 5 Sep",
        "/review/2/balance-checks",
      ],
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

    expect(view.verdict).toBe("Ready to add to your books");
    expect(view.checks.map((row) => [row.tone, row.text])).toEqual([
      ["ok", "The transaction goes to an account"],
      ["ok", "No possible duplicates"],
      ["waiting", "These drafts have no balance checks"],
    ]);
    expect(view.posting).toEqual([
      { label: "Transactions", value: "1" },
      { label: "Dates", value: "13 Sep" },
    ]);
  });
});

describe("postedView", () => {
  it("says what was added and offers the next account by name", () => {
    const view = postedView(detail(), 21, [
      { account_id: 1, name: "Sample Card", drafts: 4 },
      { account_id: 3, name: "Sample Wallet", drafts: 2 },
    ]);

    expect(view.verdict).toBe("Added to your books");
    expect(phraseText(view.outcome)).toBe(
      "21 transactions added. The last balance assertion for Sample Savings is now 3,30,000.00 on 13 Sep.",
    );
    expect(view.next).toEqual({ label: "Review Sample Card", to: "/review/1" });
    expect(view.also).toEqual({ label: "All accounts", to: "/review" });
  });

  it("sends the user Home when no account has drafts left", () => {
    const view = postedView(detail({}, { closing: null }), 1, []);

    expect(phraseText(view.outcome)).toBe("1 transaction added.");
    expect(view.next).toEqual({ label: "Go to Home", to: "/" });
    expect(view.also).toEqual({
      label: "Import another statement",
      to: "/import",
    });
  });

  it("carries the first run to the next account and to the picker", () => {
    const view = postedView(
      detail(),
      21,
      [{ account_id: 1, name: "Sample Card", drafts: 4 }],
      true,
    );

    expect(view.verdict).toBe("Added to your books");
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
    const view = postedView(detail(), 21, [], true);

    expect(view.verdict).toBe("Your books are set up.");
    expect(phraseText(view.outcome)).toBe(
      "21 transactions added. The last balance assertion for Sample Savings is now 3,30,000.00 on 13 Sep.",
    );
    expect(view.next).toEqual({ label: "Go to Home", to: "/" });
    expect(view.also).toBeUndefined();
  });
});

describe("the drafts' way into the books", () => {
  const journey = (view: {
    journey: { title: string; status: string; detail: string }[];
  }) => view.journey.map((step) => [step.title, step.status, step.detail]);

  it("waits on review while a check blocks", () => {
    expect(journey(overviewView(detail({ uncategorised: 12 })))).toEqual([
      ["Import as drafts", "done", "21 transactions · 1–13 Sep"],
      ["Review", "current", "Categorization, duplicates and balances"],
      ["Add to your books", "waiting", "Then they show in your reports"],
    ]);
  });

  it("waits on the add once every check passes, and is done after it", () => {
    expect(journey(overviewView(detail())).slice(1)).toEqual([
      ["Review", "done", "Every check passes"],
      ["Add to your books", "current", "Then they show in your reports"],
    ]);
    expect(journey(postedView(detail(), 21, [])).slice(2)).toEqual([
      ["Add to your books", "done", "They show in your reports"],
    ]);
  });

  it("notes what the import categorized, only after one", () => {
    const counts = { drafts: 21, categorized: 9 };
    expect(
      overviewView(detail({ uncategorised: 12 }), counts).checks[0].note,
    ).toBe("9 of 21 categorized automatically");
    expect(
      overviewView(detail({ uncategorised: 12 })).checks[0].note,
    ).toBeUndefined();
  });
});

describe("the notice after an import", () => {
  const counts = { drafts: 21, categorized: 9 };

  it("sends the user to categorize what is left, then add", () => {
    const notice = arrivalNotice(detail({ uncategorised: 12 }), counts);
    expect(notice).toEqual({
      title: "21 transactions imported",
      facts: [
        { label: "Categorized automatically", value: "9" },
        { label: "Need an account", value: "12" },
      ],
      next: "Next: give the 12 an account, then add them to your books.",
      action: {
        label: "Categorize 12",
        to: "/review/2/drafts?filter%5Baccount_id%5D%5Bis%5D=null",
      },
    });
  });

  it("names the problems, and the first to look into", () => {
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
    expect(notice.next).toBe("Next: check the 2 possible duplicates.");
    expect(notice.action).toEqual({
      label: "See the duplicates",
      to: "/review/2/duplicates",
    });
  });

  it("leaves the add to the Overview when nothing blocks it", () => {
    const notice = arrivalNotice(detail(), { drafts: 21, categorized: 21 });
    expect(notice.next).toBe("Next: add them to your books.");
    expect(notice.action).toBeUndefined();
  });
});

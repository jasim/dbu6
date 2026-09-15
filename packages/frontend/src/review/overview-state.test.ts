import { describe, expect, it } from "vitest";
import type { ReviewAccount, ReviewAccountDetail } from "dbu6-shared";
import { overviewView, phraseText, postedView } from "./overview-state";

function detail(
  account: Partial<ReviewAccount> = {},
  overrides: Partial<ReviewAccountDetail> = {},
): ReviewAccountDetail {
  return {
    account: {
      account_id: 2,
      path: "assets:bank:sample-savings",
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
    closing: { date: "2026-09-13", balance: 326445 },
    failing: [],
    duplicates: [],
    other_accounts: [],
    ...overrides,
  };
}

const failing = (date: string, draft_id: number) => ({
  date,
  draft_id,
  running_balance: 336445,
  assertion: 326445,
  diff: 10000,
});

describe("overviewView", () => {
  it("is ready when every check passes, and says what posting does", () => {
    const view = overviewView(detail());

    expect(view.verdict).toBe("Ready to add to your books");
    expect(view.waiting).toBeUndefined();
    expect(view.button).toBe("Add 21 to my books");
    expect(view.checks.map((row) => [row.tone, row.text])).toEqual([
      ["ok", "All 21 transactions have a category"],
      ["ok", "No possible duplicates"],
      ["ok", "Every balance check passes"],
    ]);
    expect(view.checks.every((row) => row.link === undefined)).toBe(true);
    expect(phraseText(view.posting!)).toBe(
      "Adds 21 transactions from 1–13 Sep. Sample Savings will then be checked to 13 Sep at ₹3,26,445.00.",
    );
    expect(view.posting).toContainEqual({ figure: "₹3,26,445.00" });
  });

  it("is not ready while a check fails, and waits for the one reason", () => {
    const view = overviewView(detail({ uncategorised: 12 }));

    expect(view.verdict).toBe("Not ready to add yet");
    expect(view.posting).toBeUndefined();
    expect(view.waiting).toBe("12 still need a category");
    expect(view.checks[0]).toEqual({
      check: "categories",
      tone: "attention",
      text: "12 transactions need a category",
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
      "1 still needs a category · 2 possible duplicates · 3 balance checks fail",
    );
    expect(
      view.checks.map((row) => [row.tone, row.text, row.link?.to]),
    ).toEqual([
      [
        "attention",
        "1 transaction needs a category",
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
      ["ok", "The transaction has a category"],
      ["ok", "No possible duplicates"],
      ["waiting", "These drafts have no balance checks"],
    ]);
    expect(phraseText(view.posting!)).toBe("Adds 1 transaction from 13 Sep.");
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
      "21 transactions added. Sample Savings is checked to 13 Sep at ₹3,26,445.00.",
    );
    expect(view.next).toEqual({ label: "Review Sample Card", to: "/review/1" });
    expect(view.also).toEqual({ label: "All accounts", to: "/review" });
  });

  it("sends the user to import when no account has drafts left", () => {
    const view = postedView(detail({}, { closing: null }), 1, []);

    expect(phraseText(view.outcome)).toBe("1 transaction added.");
    expect(view.next).toEqual({ label: "Import statements", to: "/import" });
    expect(view.also).toBeUndefined();
  });
});

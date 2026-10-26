import { describe, expect, it } from "vitest";
import type { PostedOverview } from "../../shared/index";
import {
  averageLabel,
  categoryBars,
  categoryRows,
  holdingAccounts,
  monthDates,
  monthForKey,
  monthSteps,
  otherWorthChange,
  waitingLabel,
} from "./state";

describe("months", () => {
  it("knows a month's days, February in a leap year too", () => {
    expect(monthDates("2026-04")).toEqual({
      first_date: "2026-04-01",
      last_date: "2026-04-30",
    });
    expect(monthDates("2024-02").last_date).toBe("2024-02-29");
  });

  it("steps between the books' first month and this month", () => {
    expect(monthSteps("2026-04", "2026-02", "2026-10-25")).toEqual({
      previous: "2026-03",
      next: "2026-05",
    });
    expect(monthSteps("2026-02", "2026-02", "2026-10-25").previous).toBeNull();
    expect(monthSteps("2026-10", "2026-02", "2026-10-25").next).toBeNull();
    expect(monthSteps("2026-04", null, "2026-10-25").previous).toBeNull();
  });
});

describe("monthForKey", () => {
  it("steps back with [ and on with ], within the bounds", () => {
    const steps = { previous: "2026-03", next: null };
    expect(monthForKey("[", steps)).toBe("2026-03");
    expect(monthForKey("]", steps)).toBeNull();
    expect(monthForKey("ArrowLeft", steps)).toBeNull();
  });
});

describe("averageLabel", () => {
  it("says how many months it is until there are twelve", () => {
    expect(averageLabel(12)).toBe("12-month average");
    expect(averageLabel(1)).toBe("Average of 1 month");
    expect(averageLabel(5)).toBe("Average of 5 months");
  });
});

describe("otherWorthChange", () => {
  const overview = (net: number, previous: number) =>
    ({
      figures: { income: 5000, spending: 4000, average: null },
      net_worth: { net, previous_net: previous },
    }) as PostedOverview;

  it("is zero when income and spending made the whole change", () => {
    expect(otherWorthChange(overview(14000, 13000))).toBe(0);
    expect(otherWorthChange(overview(14000.004, 13000))).toBe(0);
  });

  it("is what an opening balance added", () => {
    // The books' first month: nothing before, an opening balance of 10000.
    expect(otherWorthChange(overview(11000, 0))).toBe(10000);
  });
});

describe("waitingLabel", () => {
  it("names how many accounts need attention", () => {
    expect(waitingLabel(2)).toBe("2 accounts need attention");
    expect(waitingLabel(1)).toBe("1 account needs attention");
    expect(waitingLabel(0)).toBeNull();
  });
});

describe("categoryRows", () => {
  const overview = (
    categories: PostedOverview["categories"],
    spending: number,
    average: number | null,
  ) =>
    ({
      categories,
      figures: {
        income: 0,
        spending,
        average:
          average === null ? null : { months: 3, income: 0, spending: average },
      },
    }) as PostedOverview;
  const summary = (rows: ReturnType<typeof categoryRows>) =>
    rows.map((row) => [row.name, row.amount, row.average]);

  it("adds Other and Total, so the table adds up to the spending", () => {
    const rows = categoryRows(
      overview(
        [
          { account_id: 1, name: "Housing", amount: 3000, average: 3000 },
          { account_id: 2, name: "Food", amount: 1500, average: 2000 },
        ],
        5000,
        6000,
      ),
    );
    expect(summary(rows)).toEqual([
      ["Housing", 3000, 3000],
      ["Food", 1500, 2000],
      ["Other", 500, 1000],
      ["Total", 5000, 6000],
    ]);
  });

  it("puts a category with nothing this month in Other's average", () => {
    // Travel had nothing this month and fell out of the list: its average
    // is in Other's.
    const rows = categoryRows(
      overview(
        [{ account_id: 1, name: "Housing", amount: 3000, average: 3000 }],
        3000,
        4000,
      ),
    );
    expect(summary(rows)).toEqual([
      ["Housing", 3000, 3000],
      ["Other", 0, 1000],
      ["Total", 3000, 4000],
    ]);
  });

  it("leaves Other out when the categories cover everything", () => {
    const rows = categoryRows(
      overview(
        [
          { account_id: 1, name: "Housing", amount: 3000.1, average: 0.2 },
          { account_id: 2, name: "Refunds", amount: -0.1, average: 0.1 },
        ],
        3000,
        0.3,
      ),
    );
    expect(rows.map((row) => row.kind)).toEqual([
      "category",
      "category",
      "total",
    ]);
  });

  it("has no averages before the books have a month to average", () => {
    const rows = categoryRows(
      overview(
        [{ account_id: 1, name: "Housing", amount: 3000, average: null }],
        4000,
        null,
      ),
    );
    expect(summary(rows)).toEqual([
      ["Housing", 3000, null],
      ["Other", 1000, null],
      ["Total", 4000, null],
    ]);
  });

  it("has no rows without categories", () => {
    expect(categoryRows(overview([], 0, null))).toEqual([]);
  });
});

describe("holdingAccounts", () => {
  const account = (id: number, until: string | null) => ({
    account_id: id,
    name: `Sample ${id}`,
    kind: "bank" as const,
    balance: 0,
    books_until: until,
  });
  const overview = (
    until: string | null,
    accounts: ReturnType<typeof account>[],
  ) => ({ complete_until: until, accounts }) as PostedOverview;
  const names = (held: ReturnType<typeof holdingAccounts>) =>
    held && { named: held.named.map((a) => a.account_id), more: held.more };

  it("names the accounts behind the others", () => {
    expect(
      names(
        holdingAccounts(
          overview("2026-03-31", [
            account(1, "2026-04-30"),
            account(2, "2026-03-31"),
            account(3, null),
          ]),
        ),
      ),
    ).toEqual({ named: [2], more: 0 });
  });

  it("names two and counts the rest", () => {
    const behind = [2, 3, 4].map((id) => account(id, "2026-03-31"));
    expect(
      names(
        holdingAccounts(
          overview("2026-03-31", [account(1, "2026-04-30"), ...behind]),
        ),
      ),
    ).toEqual({ named: [2, 3], more: 1 });
  });

  it("names none when every checked account stops there", () => {
    expect(
      holdingAccounts(
        overview("2026-03-31", [
          account(1, "2026-03-31"),
          account(2, "2026-03-31"),
          account(3, null),
        ]),
      ),
    ).toBeNull();
    expect(holdingAccounts(overview(null, [account(1, null)]))).toBeNull();
  });
});

describe("categoryBars", () => {
  const row = (
    kind: "category" | "other" | "total",
    amount: number,
    average: number | null,
  ) => ({ kind, account_id: null, name: kind, amount, average });

  it("puts bars and ticks on one scale, the largest of either, Total aside", () => {
    expect(
      categoryBars([
        row("category", 1000, 2000),
        row("category", 500, null),
        row("other", 250, 0),
        row("total", 1750, 2000),
      ]),
    ).toEqual([
      { amount: 0.5, average: 1 },
      { amount: 0.25, average: null },
      { amount: 0.125, average: null },
      null,
    ]);
  });

  it("draws nothing for a refund, and no bars when nothing was spent", () => {
    expect(categoryBars([row("category", -500, 1000)])).toEqual([
      { amount: 0, average: 1 },
    ]);
    expect(
      categoryBars([row("category", -500, null), row("total", -500, null)]),
    ).toEqual([null, null]);
  });
});

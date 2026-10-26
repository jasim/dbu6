import { describe, expect, it } from "vitest";
import type { PostedOverview } from "../../shared/index";
import {
  averageLabel,
  categoryRows,
  difference,
  monthDates,
  monthSteps,
  netWorthChange,
  savedShareDifference,
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

describe("averageLabel", () => {
  it("says how many months it is until there are twelve", () => {
    expect(averageLabel(12)).toBe("12-month average");
    expect(averageLabel(1)).toBe("Average of 1 month");
    expect(averageLabel(5)).toBe("Average of 5 months");
  });
});

describe("netWorthChange", () => {
  it("compares with the month before's", () => {
    const overview = {
      month: "2026-01",
      net_worth: { assets: 0, liabilities: 0, net: 14000, previous_net: 15000 },
    } as PostedOverview;
    expect(netWorthChange(overview)).toEqual({
      label: "Change since Dec 2025",
      value: -1000,
    });
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

describe("difference", () => {
  it("is the month less the average, as the columns show them", () => {
    expect(difference(1200, 1000)).toBe("+200.00");
    // Spending shows negative: spending 500 more than usual reads −500.
    expect(difference(-3500, -3000)).toBe("\u2212500.00");
    expect(difference(-0.004, 0)).toBe("0.00");
    expect(difference(1200, null)).toBeNull();
  });
});

describe("savedShareDifference", () => {
  it("compares saved % in points", () => {
    const average = { income: 1000, spending: 800 };
    expect(savedShareDifference({ income: 1000, spending: 600 }, average)).toBe(
      "+20 pts",
    );
    expect(savedShareDifference({ income: 1000, spending: 900 }, average)).toBe(
      "\u221210 pts",
    );
    expect(savedShareDifference({ income: 1000, spending: 800 }, average)).toBe(
      "0 pts",
    );
  });

  it("has none when either month saved nothing to share", () => {
    const average = { income: 1000, spending: 800 };
    expect(savedShareDifference({ income: 0, spending: 600 }, average)).toBe("—");
    expect(
      savedShareDifference({ income: 1000, spending: 1200 }, average),
    ).toBe("—");
    expect(savedShareDifference(average, null)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { PostedOverview } from "../../shared/index";
import {
  averageLabel,
  monthDates,
  monthSteps,
  netWorthChange,
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

import { describe, expect, it } from "vitest";
import type {
  HomeLedgerAccount,
  HomeSummary,
  PostedOverview,
} from "../../shared/index";
import {
  averageLabel,
  monthDates,
  monthSteps,
  netWorthChange,
  waitingInUpdate,
  waitingLabel,
} from "./state";

function account(overrides: Partial<HomeLedgerAccount> = {}): HomeLedgerAccount {
  return {
    in_ledger: true,
    account_id: 1,
    name: "Sample Savings",
    kind: "bank",
    has_parser: true,
    path: "Sample Savings",
    parent_path: null,
    checkpoint: { date: "2026-04-30", balance: 1000 },
    statement_differences: 0,
    drafts: 0,
    uncategorised: 0,
    duplicates: 0,
    balance_checks: 0,
    failing_checks: 0,
    ...overrides,
  };
}

function summary(accounts: HomeLedgerAccount[]): HomeSummary {
  return {
    has_chart: true,
    accounts,
    totals: {
      drafts: 0,
      uncategorised: 0,
      duplicates: 0,
      balance_checks: 0,
      failing_checks: 0,
    },
    any_imported: true,
  };
}

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

describe("waitingInUpdate", () => {
  it("counts the accounts Update shows something waiting on", () => {
    const view = summary([
      account(),
      account({ account_id: 2, drafts: 3 }),
      account({ account_id: 3, statement_differences: 1 }),
    ]);
    expect(waitingInUpdate(view)).toBe(2);
    expect(waitingLabel(2)).toBe("2 accounts need attention");
    expect(waitingLabel(1)).toBe("1 account needs attention");
    expect(waitingLabel(0)).toBeNull();
  });
});

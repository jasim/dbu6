import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isoDate, reportDateRange } from "./dates.js";
import { reportsContract } from "./reports.js";

const NOT_DATES = ["2026-02-30", "2026-13-01", "01/01/2026", "2026-1-5", ""];

describe("a report date", () => {
  it("is a real calendar day as YYYY-MM-DD", () => {
    expect(isoDate.safeParse("2024-02-29").success).toBe(true);
    for (const value of NOT_DATES) {
      expect(isoDate.safeParse(value).success, value).toBe(false);
    }
  });
});

describe("a report's period", () => {
  it("may leave either end open, or both", () => {
    for (const dates of [
      {},
      { from_date: "2026-01-01" },
      { to_date: "2026-01-31" },
      { from_date: "2026-01-01", to_date: "2026-01-01" },
    ]) {
      expect(reportDateRange.safeParse(dates).success).toBe(true);
    }
  });

  it("refuses dates out of order", () => {
    expect(
      reportDateRange.safeParse({
        from_date: "2026-02-01",
        to_date: "2026-01-31",
      }).success,
    ).toBe(false);
  });

  it("keeps its order check when a report adds parameters", () => {
    const query = reportDateRange.extend({ id: z.string() });
    expect(
      query.safeParse({
        id: "x",
        from_date: "2026-02-01",
        to_date: "2026-01-31",
      }).success,
    ).toBe(false);
  });
});

// Every route of ours that takes a date reads it by the one rule.
describe("every report's dates", () => {
  const valid: Record<string, string> = {
    account_id: "7",
    section: "income",
    from_date: "2026-01-01",
    to_date: "2026-01-31",
    as_of_date: "2026-01-31",
  };
  const routes = Object.entries(reportsContract).flatMap(([name, route]) => {
    const query = route.query as z.ZodObject;
    const keys = Object.keys(query.shape);
    const dated = keys.filter((key) => key.endsWith("_date"));
    return dated.length === 0
      ? []
      : [
          {
            name,
            query,
            dated,
            input: Object.fromEntries(keys.map((key) => [key, valid[key]])),
          },
        ];
  });

  it("covers the dated reports", () => {
    expect(routes.map(({ name }) => name).sort()).toEqual([
      "accountLedger",
      "accountLedgerHledger",
      "assetInflows",
      "balanceSheet",
      "dayBook",
      "expenseBreakdown",
      "incomeExpenses",
      "incomeExpensesEntries",
      "incomeStatement",
      "monthlySummary",
      "netWorth",
      "trialBalance",
    ]);
  });

  it.each(routes)("$name takes real dates", ({ query, input }) => {
    expect(query.safeParse(input).success).toBe(true);
  });

  it.each(routes)(
    "$name refuses a date that isn't one",
    ({ query, dated, input }) => {
      for (const key of dated) {
        for (const value of NOT_DATES) {
          expect(
            query.safeParse({ ...input, [key]: value }).success,
            `${key}=${value}`,
          ).toBe(false);
        }
      }
    },
  );

  it.each(routes.filter(({ dated }) => dated.includes("from_date")))(
    "$name refuses a period out of order",
    ({ query, input }) => {
      expect(
        query.safeParse({
          ...input,
          from_date: "2026-02-01",
          to_date: "2026-01-31",
        }).success,
      ).toBe(false);
    },
  );
});

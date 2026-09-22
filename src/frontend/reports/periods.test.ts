import { describe, expect, it, vi } from "vitest";
import {
  financialYearOf,
  financialYearSpan,
  parsePreset,
  parseSpan,
  PERIOD_PRESETS,
  presetSpan,
  type PeriodPreset,
} from "./periods";
import { today } from "./shared";

vi.mock("@sapporta/frontend", () => ({ appTimeZone: () => "Asia/Kolkata" }));

const dates = (first_date: string, last_date: string) => ({
  first_date,
  last_date,
});

function spans(day: string): Record<PeriodPreset, string> {
  return Object.fromEntries(
    PERIOD_PRESETS.map(({ id }) => {
      const { first_date, last_date } = presetSpan(id, day);
      return [id, `${first_date} – ${last_date}`];
    }),
  ) as Record<PeriodPreset, string>;
}

describe("presets", () => {
  it("resolve on the last day of a month", () => {
    expect(spans("2026-09-30")).toEqual({
      "this-month": "2026-09-01 – 2026-09-30",
      "last-month": "2026-08-01 – 2026-08-31",
      "last-3-months": "2026-07-01 – 2026-09-30",
      "last-12-months": "2025-10-01 – 2026-09-30",
      "this-financial-year": "2026-04-01 – 2026-09-30",
      "last-financial-year": "2025-04-01 – 2026-03-31",
    });
  });

  it("resolve on the first day of the next month", () => {
    expect(spans("2026-10-01")).toEqual({
      "this-month": "2026-10-01 – 2026-10-01",
      "last-month": "2026-09-01 – 2026-09-30",
      "last-3-months": "2026-08-01 – 2026-10-01",
      "last-12-months": "2025-11-01 – 2026-10-01",
      "this-financial-year": "2026-04-01 – 2026-10-01",
      "last-financial-year": "2025-04-01 – 2026-03-31",
    });
  });

  it("start a new financial year on 1 April, not 31 March", () => {
    expect(spans("2026-03-31")).toEqual({
      "this-month": "2026-03-01 – 2026-03-31",
      "last-month": "2026-02-01 – 2026-02-28",
      "last-3-months": "2026-01-01 – 2026-03-31",
      "last-12-months": "2025-04-01 – 2026-03-31",
      "this-financial-year": "2025-04-01 – 2026-03-31",
      "last-financial-year": "2024-04-01 – 2025-03-31",
    });
    expect(spans("2026-04-01")).toEqual({
      "this-month": "2026-04-01 – 2026-04-01",
      "last-month": "2026-03-01 – 2026-03-31",
      "last-3-months": "2026-02-01 – 2026-04-01",
      "last-12-months": "2025-05-01 – 2026-04-01",
      "this-financial-year": "2026-04-01 – 2026-04-01",
      "last-financial-year": "2025-04-01 – 2026-03-31",
    });
  });

  it("cross a new year", () => {
    expect(presetSpan("last-3-months", "2026-02-10")).toEqual(
      dates("2025-12-01", "2026-02-10"),
    );
  });

  it("follow the workspace's day, not UTC's", () => {
    vi.useFakeTimers();
    // 20:00 in UTC on 31 March is 01:30 on 1 April in Kolkata.
    vi.setSystemTime(new Date("2026-03-31T20:00:00Z"));
    try {
      expect(presetSpan("this-financial-year", today())).toEqual(
        dates("2026-04-01", "2026-04-01"),
      );
      expect(presetSpan("last-month", today())).toEqual(
        dates("2026-03-01", "2026-03-31"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("are read from a query string by name only", () => {
    expect(parsePreset("last-3-months")).toBe("last-3-months");
    expect(parsePreset("Last 3 months")).toBeNull();
    expect(parsePreset(null)).toBeNull();
  });
});

describe("the financial year", () => {
  it("is the one a month falls in", () => {
    expect(financialYearOf("2026-03")).toBe(2025);
    expect(financialYearOf("2026-04")).toBe(2026);
  });

  it("runs from 1 April to 31 March", () => {
    expect(financialYearSpan(2027)).toEqual(dates("2027-04-01", "2028-03-31"));
  });
});

describe("dates from a query string", () => {
  it("are a span when both are calendar dates in order", () => {
    expect(parseSpan("2026-03-05", "2026-03-20")).toEqual(
      dates("2026-03-05", "2026-03-20"),
    );
    expect(parseSpan("2026-03-05", "2026-03-05")).toEqual(
      dates("2026-03-05", "2026-03-05"),
    );
  });

  it("are nothing when either is missing, invalid, or out of order", () => {
    expect(parseSpan("2026-03-01", null)).toBeNull();
    expect(parseSpan(null, "2026-03-01")).toBeNull();
    expect(parseSpan("2026-02-30", "2026-03-31")).toBeNull();
    expect(parseSpan("1/3/2026", "2026-03-31")).toBeNull();
    expect(parseSpan("2026-04-01", "2026-03-01")).toBeNull();
  });
});

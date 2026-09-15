import { afterEach, describe, expect, it, vi } from "vitest";
import { today } from "../shared";
import {
  activePreset,
  emptyPeriodSentence,
  financialYearOf,
  monthOptions,
  periodHeading,
  pickedLabel,
  pickedMonths,
  pickFrom,
  pickTo,
  presetSearch,
  presetSpan,
  readPeriod,
  spanSearch,
  withinOneMonth,
  type Preset,
} from "./period";

vi.mock("@sapporta/frontend", () => ({ appTimeZone: () => "Asia/Kolkata" }));

const dates = (first_date: string, last_date: string) => ({
  first_date,
  last_date,
});

function spans(day: string): Record<Preset, string> {
  const presets: Preset[] = [
    "this-month",
    "last-month",
    "last-12-months",
    "this-financial-year",
    "last-financial-year",
  ];
  return Object.fromEntries(
    presets.map((preset) => {
      const { first_date, last_date } = presetSpan(preset, day);
      return [preset, `${first_date} – ${last_date}`];
    }),
  ) as Record<Preset, string>;
}

describe("presets", () => {
  it("resolve on the last day of a month", () => {
    expect(spans("2026-09-30")).toEqual({
      "this-month": "2026-09-01 – 2026-09-30",
      "last-month": "2026-08-01 – 2026-08-31",
      "last-12-months": "2025-10-01 – 2026-09-30",
      "this-financial-year": "2026-04-01 – 2026-09-30",
      "last-financial-year": "2025-04-01 – 2026-03-31",
    });
  });

  it("resolve on the first day of the next month", () => {
    expect(spans("2026-10-01")).toEqual({
      "this-month": "2026-10-01 – 2026-10-01",
      "last-month": "2026-09-01 – 2026-09-30",
      "last-12-months": "2025-11-01 – 2026-10-01",
      "this-financial-year": "2026-04-01 – 2026-10-01",
      "last-financial-year": "2025-04-01 – 2026-03-31",
    });
  });

  it("start a new financial year on 1 April, not 31 March", () => {
    expect(spans("2026-03-31")).toEqual({
      "this-month": "2026-03-01 – 2026-03-31",
      "last-month": "2026-02-01 – 2026-02-28",
      "last-12-months": "2025-04-01 – 2026-03-31",
      "this-financial-year": "2025-04-01 – 2026-03-31",
      "last-financial-year": "2024-04-01 – 2025-03-31",
    });
    expect(spans("2026-04-01")).toEqual({
      "this-month": "2026-04-01 – 2026-04-01",
      "last-month": "2026-03-01 – 2026-03-31",
      "last-12-months": "2025-05-01 – 2026-04-01",
      "this-financial-year": "2026-04-01 – 2026-04-01",
      "last-financial-year": "2025-04-01 – 2026-03-31",
    });
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

  it("know which financial year a month is in", () => {
    expect(financialYearOf("2026-03")).toBe(2025);
    expect(financialYearOf("2026-04")).toBe(2026);
  });
});

describe("the query string", () => {
  const day = "2026-09-16";
  const read = (query: string) => readPeriod(new URLSearchParams(query), day);

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to the last 12 months", () => {
    expect(read("")).toEqual({
      kind: "preset",
      preset: "last-12-months",
      span: dates("2025-10-01", "2026-09-16"),
    });
    expect(read("period=next-decade").kind).toBe("preset");
  });

  it("reads a named preset", () => {
    expect(read("period=last-financial-year")).toEqual({
      kind: "preset",
      preset: "last-financial-year",
      span: dates("2025-04-01", "2026-03-31"),
    });
  });

  it("lets valid dates win over a preset", () => {
    expect(
      read("period=this-month&from_date=2026-03-05&to_date=2026-03-20"),
    ).toEqual({ kind: "picked", span: dates("2026-03-05", "2026-03-20") });
  });

  it("ignores dates that are invalid, missing or out of order", () => {
    for (const query of [
      "from_date=2026-02-30&to_date=2026-03-31&period=this-month",
      "from_date=2026-03-01&period=this-month",
      "from_date=2026-04-01&to_date=2026-03-01&period=this-month",
      "from_date=1/3/2026&to_date=2026-03-31&period=this-month",
    ]) {
      expect(read(query)).toMatchObject({ preset: "this-month" });
    }
  });

  it("writes a preset by name and picked dates as dates", () => {
    expect(presetSearch("this-month").toString()).toBe("period=this-month");
    expect(spanSearch(dates("2026-03-01", "2026-03-31")).toString()).toBe(
      "from_date=2026-03-01&to_date=2026-03-31",
    );
  });

  it("round-trips a preset relative to the day it is read", () => {
    const search = presetSearch("this-month");
    expect(readPeriod(search, "2026-10-02").span).toEqual(
      dates("2026-10-01", "2026-10-02"),
    );
  });
});

describe("the lit preset", () => {
  const day = "2026-09-16";

  it("is the chosen preset", () => {
    expect(activePreset(readPeriod(presetSearch("last-month"), day), day)).toBe(
      "last-month",
    );
  });

  it("is the preset that picked dates match exactly, else none", () => {
    const picked = (first: string, last: string) =>
      activePreset({ kind: "picked", span: dates(first, last) }, day);

    expect(picked("2026-08-01", "2026-08-31")).toBe("last-month");
    expect(picked("2025-10-01", "2026-09-16")).toBe("last-12-months");
    expect(picked("2025-10-01", "2026-09-15")).toBeNull();
    expect(picked("2026-03-01", "2026-06-30")).toBeNull();
  });
});

describe("picking months", () => {
  const day = "2026-09-16";

  it("covers whole months, up to today", () => {
    expect(pickedMonths({ from: "2026-03", to: "2026-06" }, day)).toEqual(
      dates("2026-03-01", "2026-06-30"),
    );
    expect(pickedMonths({ from: "2026-02", to: "2026-02" }, day)).toEqual(
      dates("2026-02-01", "2026-02-28"),
    );
    expect(pickedMonths({ from: "2026-07", to: "2026-09" }, day)).toEqual(
      dates("2026-07-01", "2026-09-16"),
    );
    expect(pickedMonths({ from: "2026-07", to: "2026-12" }, day)).toEqual(
      dates("2026-07-01", "2026-09-16"),
    );
  });

  it("moves the other month when the two would cross", () => {
    const current = { from: "2026-03", to: "2026-06" };
    expect(pickFrom("2026-08", current)).toEqual({
      from: "2026-08",
      to: "2026-08",
    });
    expect(pickFrom("2026-01", current)).toEqual({
      from: "2026-01",
      to: "2026-06",
    });
    expect(pickTo("2026-02", current)).toEqual({
      from: "2026-02",
      to: "2026-02",
    });
    expect(pickTo("2026-07", current)).toEqual({
      from: "2026-03",
      to: "2026-07",
    });
  });

  it("offers the months from the first in the books to this one, newest first", () => {
    expect(
      monthOptions("2026-06", dates("2026-08-01", "2026-09-16"), day),
    ).toEqual(["2026-09", "2026-08", "2026-07", "2026-06"]);
    expect(monthOptions(null, dates("2026-08-01", "2026-08-31"), day)).toEqual([
      "2026-09",
      "2026-08",
    ]);
  });

  it("tests whether dates fall within one month", () => {
    expect(withinOneMonth(dates("2026-03-05", "2026-03-20"))).toBe(true);
    expect(withinOneMonth(dates("2026-03-31", "2026-04-01"))).toBe(false);
  });
});

describe("labels", () => {
  const day = "2026-09-16";

  it("read the dates under the title in full", () => {
    expect(periodHeading(dates("2025-10-01", "2026-09-16"))).toBe(
      "1 October 2025 – 16 September 2026",
    );
  });

  it("read picked months as months and other dates as days", () => {
    expect(pickedLabel(dates("2026-03-01", "2026-06-30"), day)).toBe(
      "Mar – Jun 2026",
    );
    expect(pickedLabel(dates("2026-07-01", "2026-09-16"), day)).toBe(
      "Jul – Sep 2026",
    );
    expect(pickedLabel(dates("2026-03-05", "2026-03-20"), day)).toBe(
      "5–20 Mar 2026",
    );
  });

  it("say what an empty period covers", () => {
    expect(emptyPeriodSentence(dates("2026-04-01", "2026-04-30"))).toBe(
      "Nothing in your books falls between 1 Apr and 30 Apr 2026.",
    );
    expect(emptyPeriodSentence(dates("2026-04-05", "2026-04-05"))).toBe(
      "Nothing in your books falls on 5 Apr 2026.",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  activePreset,
  choosePeriod,
  monthOptions,
  PERIOD_CHOICES,
  periodChoice,
  periodLabel,
  periodSpan,
  pickedMonths,
  pickFrom,
  pickTo,
  readReportPeriod,
  reportDates,
  stepPeriod,
  writeReportPeriod,
  type ReportPeriod,
} from "./report-period";

const day = "2026-09-16";
const read = (query: string) =>
  readReportPeriod(new URLSearchParams(query), day);
const write = (period: ReportPeriod, query = "") =>
  writeReportPeriod(new URLSearchParams(query), period).toString();
const dates = (first_date: string, last_date: string) => ({
  first_date,
  last_date,
});

describe("reading the query string", () => {
  it("is all time with no period, as a report with no dates always was", () => {
    expect(read("")).toEqual({ kind: "all-time" });
    expect(read("period=next-decade")).toEqual({ kind: "all-time" });
  });

  it("resolves a named preset against today", () => {
    expect(read("period=last-3-months")).toEqual({
      kind: "preset",
      preset: "last-3-months",
      span: dates("2026-07-01", "2026-09-16"),
    });
  });

  it("reads dates, which a link carries, as a custom range over any preset", () => {
    expect(
      read("period=this-month&from_date=2026-03-05&to_date=2026-03-20"),
    ).toEqual({ kind: "custom", span: dates("2026-03-05", "2026-03-20") });
  });

  it("reads a lone end date as its financial year to that day, over any preset", () => {
    expect(read("to_date=2026-07-31&period=this-month")).toEqual({
      kind: "custom",
      span: dates("2026-04-01", "2026-07-31"),
    });
    // March is the year before's.
    expect(read("to_date=2026-03-31")).toEqual({
      kind: "custom",
      span: dates("2025-04-01", "2026-03-31"),
    });
  });

  it("keeps a custom range with nothing picked when the dates don't make a span", () => {
    for (const query of [
      "period=custom",
      "from_date=2026-03-01",
      "to_date=2026-02-30",
      "from_date=2026-02-30&to_date=2026-03-31",
      "from_date=2026-04-01&to_date=2026-03-01",
      "from_date=&to_date=",
    ]) {
      expect(read(query)).toEqual({ kind: "custom", span: null });
    }
  });
});

describe("writing the query string", () => {
  it("names a preset, so a bookmark stays relative", () => {
    const preset = read("period=this-month");
    expect(write(preset)).toBe("period=this-month");
    expect(
      readReportPeriod(new URLSearchParams(write(preset)), "2026-10-02"),
    ).toMatchObject({ span: dates("2026-10-01", "2026-10-02") });
  });

  it("writes picked dates as dates, and an empty custom range by name", () => {
    expect(
      write({ kind: "custom", span: dates("2026-03-01", "2026-03-31") }),
    ).toBe("from_date=2026-03-01&to_date=2026-03-31");
    expect(write({ kind: "custom", span: null })).toBe("period=custom");
  });

  it("replaces the old period and keeps every other parameter", () => {
    expect(
      write(
        { kind: "all-time" },
        "account_id=7&from_date=2026-03-01&to_date=2026-03-31&period=custom",
      ),
    ).toBe("account_id=7");
    expect(write(read("period=last-month"), "account_id=7&from_date=x")).toBe(
      "account_id=7&period=last-month",
    );
  });

  it("round-trips every choice", () => {
    for (const { value } of PERIOD_CHOICES) {
      const period = choosePeriod(value, { kind: "all-time" }, day);
      expect(read(write(period))).toEqual(period);
    }
  });
});

describe("a report that defaults to a preset", () => {
  const readDefault = (query: string) =>
    readReportPeriod(new URLSearchParams(query), day, "this-month");
  const writeDefault = (period: ReportPeriod) =>
    writeReportPeriod(new URLSearchParams(), period, "this-month").toString();

  it("opens on the preset when the query string names no period", () => {
    expect(readDefault("")).toEqual({
      kind: "preset",
      preset: "this-month",
      span: dates("2026-09-01", "2026-09-16"),
    });
    expect(readDefault("period=last-month")).toMatchObject({
      preset: "last-month",
    });
  });

  it("names all time, so choosing it sticks", () => {
    expect(writeDefault({ kind: "all-time" })).toBe("period=all-time");
    expect(readDefault("period=all-time")).toEqual({ kind: "all-time" });
  });

  it("round-trips every choice", () => {
    for (const { value } of PERIOD_CHOICES) {
      const period = choosePeriod(value, { kind: "all-time" }, day);
      expect(readDefault(writeDefault(period))).toEqual(period);
    }
  });
});

describe("the dates a report is asked for", () => {
  it("are none for all time or an unpicked range", () => {
    expect(reportDates({ kind: "all-time" })).toEqual({});
    expect(reportDates({ kind: "custom", span: null })).toEqual({});
  });

  it("are the span's ends otherwise", () => {
    expect(reportDates(read("period=last-financial-year"))).toEqual({
      from_date: "2025-04-01",
      to_date: "2026-03-31",
    });
  });
});

describe("choosing from the menu", () => {
  it("lists all time, the presets, then a custom range", () => {
    expect(PERIOD_CHOICES.map(({ label }) => label)).toEqual([
      "All time",
      "This month",
      "Last month",
      "Last 3 months",
      "Last 12 months",
      "This financial year",
      "Last financial year",
      "Custom range…",
    ]);
  });

  it("shows the chosen item", () => {
    for (const { value } of PERIOD_CHOICES) {
      expect(periodChoice(choosePeriod(value, { kind: "all-time" }, day))).toBe(
        value,
      );
    }
  });

  it("starts a custom range from the preset's dates, so nothing changes yet", () => {
    const preset = read("period=this-financial-year");
    const custom = choosePeriod("custom", preset, day);
    expect(custom).toEqual({
      kind: "custom",
      span: dates("2026-04-01", "2026-09-16"),
    });
    expect(reportDates(custom)).toEqual(reportDates(preset));
  });

  it("keeps a custom range's dates when custom range is chosen again", () => {
    const picked: ReportPeriod = {
      kind: "custom",
      span: dates("2026-03-01", "2026-03-31"),
    };
    expect(choosePeriod("custom", picked, day)).toBe(picked);
    expect(choosePeriod("custom", { kind: "all-time" }, day)).toEqual({
      kind: "custom",
      span: null,
    });
  });
});

const custom = (first: string, last: string): ReportPeriod => ({
  kind: "custom",
  span: dates(first, last),
});
const preset = (query: string) => read(`period=${query}`);

describe("the lit preset", () => {
  it("is the chosen preset", () => {
    expect(activePreset(preset("last-month"), day)).toBe("last-month");
  });

  it("is the preset that picked dates match exactly, else none", () => {
    const lit = (first: string, last: string) =>
      activePreset(custom(first, last), day);
    expect(lit("2026-08-01", "2026-08-31")).toBe("last-month");
    expect(lit("2025-10-01", "2026-09-16")).toBe("last-12-months");
    expect(lit("2025-10-01", "2026-09-15")).toBeNull();
    expect(lit("2026-03-01", "2026-06-30")).toBeNull();
    expect(activePreset({ kind: "all-time" }, day)).toBeNull();
  });
});

describe("the period's name", () => {
  it("reads all time, a preset, a financial year, months, or days", () => {
    expect(periodLabel({ kind: "all-time" }, day)).toBe("All time");
    expect(periodLabel(custom("2026-08-01", "2026-08-31"), day)).toBe(
      "Last month",
    );
    expect(periodLabel(custom("2024-04-01", "2025-03-31"), day)).toBe(
      "FY 2024–25",
    );
    expect(periodLabel(custom("2026-03-01", "2026-06-30"), day)).toBe(
      "Mar – Jun 2026",
    );
    expect(periodLabel(custom("2026-06-01", "2026-09-16"), day)).toBe(
      "Jun – Sep 2026",
    );
    expect(periodLabel(custom("2026-03-05", "2026-03-20"), day)).toBe(
      "5–20 Mar 2026",
    );
    expect(periodLabel({ kind: "custom", span: null }, day)).toBe("Pick dates");
  });
});

describe("all time's dates", () => {
  it("run from the books' first day to today, or their last if later", () => {
    const all = { kind: "all-time" } as const;
    expect(periodSpan(all, dates("2023-09-30", "2026-09-01"), day)).toEqual(
      dates("2023-09-30", day),
    );
    expect(periodSpan(all, dates("2023-09-30", "2026-10-02"), day)).toEqual(
      dates("2023-09-30", "2026-10-02"),
    );
    expect(periodSpan(all, null, day)).toEqual(dates(day, day));
    expect(periodSpan(custom("2026-03-05", "2026-03-20"), null, day)).toEqual(
      dates("2026-03-05", "2026-03-20"),
    );
  });
});

describe("stepping", () => {
  const step = (period: ReportPeriod, direction: -1 | 1) => {
    const next = stepPeriod(period, direction, day);
    return next?.kind === "custom" ? next.span : next;
  };

  it("moves a month by a month, and back onto this month's preset", () => {
    expect(step(preset("this-month"), -1)).toEqual(
      dates("2026-08-01", "2026-08-31"),
    );
    expect(step(preset("last-month"), 1)).toEqual(dates("2026-09-01", day));
    expect(step(preset("this-month"), 1)).toBeNull();
  });

  it("moves a financial year by a year, a whole one before this", () => {
    expect(step(preset("this-financial-year"), -1)).toEqual(
      dates("2025-04-01", "2026-03-31"),
    );
    expect(step(custom("2024-04-01", "2025-03-31"), 1)).toEqual(
      dates("2025-04-01", "2026-03-31"),
    );
    expect(step(preset("last-financial-year"), 1)).toEqual(
      dates("2026-04-01", day),
    );
  });

  it("moves the last 12 months and picked months by as many months", () => {
    expect(step(preset("last-12-months"), -1)).toEqual(
      dates("2024-10-01", "2025-09-30"),
    );
    expect(step(custom("2026-03-01", "2026-06-30"), -1)).toEqual(
      dates("2025-11-01", "2026-02-28"),
    );
  });

  it("moves picked days by as many days", () => {
    expect(step(custom("2026-03-05", "2026-03-20"), 1)).toEqual(
      dates("2026-03-21", "2026-04-05"),
    );
  });

  it("goes nowhere over all time or before dates are picked", () => {
    expect(step({ kind: "all-time" }, -1)).toBeNull();
    expect(step({ kind: "custom", span: null }, 1)).toBeNull();
  });
});

describe("picking months", () => {
  it("covers whole months, up to today", () => {
    expect(pickedMonths({ from: "2026-03", to: "2026-06" }, day)).toEqual(
      dates("2026-03-01", "2026-06-30"),
    );
    expect(pickedMonths({ from: "2026-02", to: "2026-02" }, day)).toEqual(
      dates("2026-02-01", "2026-02-28"),
    );
    expect(pickedMonths({ from: "2026-07", to: "2026-12" }, day)).toEqual(
      dates("2026-07-01", day),
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

  it("offers the months from the books' first to this one, newest first", () => {
    expect(
      monthOptions(
        dates("2026-06-12", "2026-09-01"),
        dates("2026-08-01", day),
        day,
      ),
    ).toEqual(["2026-09", "2026-08", "2026-07", "2026-06"]);
    expect(monthOptions(null, dates("2026-08-01", "2026-08-31"), day)).toEqual([
      "2026-09",
      "2026-08",
    ]);
    expect(monthOptions(null, null, day)).toEqual(["2026-09"]);
  });
});

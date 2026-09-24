import { describe, expect, it } from "vitest";
import {
  choosePeriod,
  PERIOD_CHOICES,
  periodChoice,
  readReportPeriod,
  reportDates,
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

  it("keeps a custom range with nothing picked when the dates don't make a span", () => {
    for (const query of [
      "period=custom",
      "from_date=2026-03-01",
      "to_date=2026-03-01&period=this-month",
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

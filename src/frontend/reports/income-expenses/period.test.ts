import { describe, expect, it } from "vitest";
import {
  emptyPeriodSentence,
  periodHeading,
  readPeriod,
  withinOneMonth,
  writePeriod,
} from "./period";

const dates = (first_date: string, last_date: string) => ({
  first_date,
  last_date,
});

describe("the query string", () => {
  const day = "2026-09-16";
  const read = (query: string) => readPeriod(new URLSearchParams(query), day);

  it("defaults to the last 12 months, and reads all time when named", () => {
    expect(read("")).toEqual({
      kind: "preset",
      preset: "last-12-months",
      span: dates("2025-10-01", "2026-09-16"),
    });
    expect(read("period=custom")).toMatchObject({ preset: "last-12-months" });
    expect(read("period=all-time")).toEqual({ kind: "all-time" });
  });

  it("reads dates as every report does", () => {
    expect(read("from_date=2026-03-05&to_date=2026-03-20")).toEqual({
      kind: "custom",
      span: dates("2026-03-05", "2026-03-20"),
    });
  });

  it("keeps the account in focus and drops the selected bar", () => {
    const search = new URLSearchParams("account=spending:4&month=2026-08");
    expect(writePeriod(search, { kind: "all-time" }).toString()).toBe(
      "account=spending%3A4&period=all-time",
    );
    expect(
      writePeriod(search, {
        kind: "custom",
        span: dates("2026-03-01", "2026-03-31"),
      }).toString(),
    ).toBe("account=spending%3A4&from_date=2026-03-01&to_date=2026-03-31");
  });
});

describe("labels", () => {
  it("read the dates under the title in full", () => {
    expect(periodHeading(dates("2025-10-01", "2026-09-16"))).toBe(
      "1 October 2025 – 16 September 2026",
    );
  });

  it("tests whether dates fall within one month", () => {
    expect(withinOneMonth(dates("2026-03-05", "2026-03-20"))).toBe(true);
    expect(withinOneMonth(dates("2026-03-31", "2026-04-01"))).toBe(false);
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

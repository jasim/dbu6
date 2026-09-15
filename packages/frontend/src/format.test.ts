import { describe, expect, it } from "vitest";
import {
  agree,
  fileTypeLabel,
  formatDateRange,
  formatDaySpan,
  formatFileSize,
  formatMonth,
  formatMonthSpan,
  formatShortDate,
} from "./format";

const span = (first_date: string, last_date: string) => ({
  first_date,
  last_date,
});

describe("formatFileSize", () => {
  it("reads bytes, kilobytes and megabytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(24 * 1024)).toBe("24 KB");
    expect(formatFileSize(1.25 * 1024 * 1024)).toBe("1.3 MB");
  });
});

describe("fileTypeLabel", () => {
  it("uppercases the extension", () => {
    expect(fileTypeLabel("Acct_Statement_050505.xls")).toBe("XLS");
    expect(fileTypeLabel("sample.statement.pdf")).toBe("PDF");
    expect(fileTypeLabel("activity.html")).toBe("HTML");
  });

  it("falls back to FILE without a usable extension", () => {
    expect(fileTypeLabel("statement")).toBe("FILE");
    expect(fileTypeLabel(".hidden")).toBe("FILE");
    expect(fileTypeLabel("statement.backup")).toBe("FILE");
  });
});

describe("formatShortDate", () => {
  it("reads a date as day and month", () => {
    expect(formatShortDate("2026-09-05")).toBe("5 Sep");
    expect(formatShortDate("not a date")).toBe("not a date");
  });
});

describe("formatDaySpan", () => {
  it("names the month once for days within it", () => {
    expect(formatDaySpan(span("2026-09-01", "2026-09-13"))).toBe("1–13 Sep");
    expect(
      formatDaySpan(span("2026-09-01", "2026-09-13"), { withYear: true }),
    ).toBe("1–13 Sep 2026");
  });

  it("names both months, or both years, when the span crosses them", () => {
    expect(formatDaySpan(span("2026-08-28", "2026-09-13"))).toBe(
      "28 Aug – 13 Sep",
    );
    expect(formatDaySpan(span("2025-12-28", "2026-01-03"))).toBe(
      "28 Dec 2025 – 3 Jan 2026",
    );
  });

  it("reads a single day as one date", () => {
    expect(formatDaySpan(span("2026-09-13", "2026-09-13"))).toBe("13 Sep");
  });

  it("spells the months out when asked", () => {
    expect(
      formatDaySpan(span("2025-10-01", "2026-09-16"), { months: "long" }),
    ).toBe("1 October 2025 – 16 September 2026");
    expect(
      formatDaySpan(span("2026-04-01", "2026-09-16"), {
        withYear: true,
        months: "long",
      }),
    ).toBe("1 April – 16 September 2026");
    expect(
      formatDaySpan(span("2026-04-01", "2026-04-30"), {
        withYear: true,
        months: "long",
      }),
    ).toBe("1–30 April 2026");
  });
});

describe("month labels", () => {
  it("reads a month short or long", () => {
    expect(formatMonth("2026-03")).toBe("Mar 2026");
    expect(formatMonth("2026-03", "long")).toBe("March 2026");
  });

  it("reads a span of months with the year once when it can", () => {
    expect(formatMonthSpan("2026-03", "2026-06")).toBe("Mar – Jun 2026");
    expect(formatMonthSpan("2026-03", "2026-03")).toBe("Mar 2026");
    expect(formatMonthSpan("2025-11", "2026-02")).toBe("Nov 2025 – Feb 2026");
  });
});

describe("formatDateRange", () => {
  it("joins two dates into a sentence", () => {
    expect(formatDateRange(span("2026-08-01", "2026-08-31"))).toBe(
      "1 Aug to 31 Aug 2026",
    );
    expect(formatDateRange(span("2026-04-01", "2026-04-30"), "and")).toBe(
      "1 Apr and 30 Apr 2026",
    );
    expect(formatDateRange(span("2025-12-01", "2026-01-31"), "and")).toBe(
      "1 Dec 2025 and 31 Jan 2026",
    );
  });
});

describe("agree", () => {
  it("picks the verb form for a count", () => {
    expect(agree(1, "fails", "fail")).toBe("fails");
    expect(agree(0, "fails", "fail")).toBe("fail");
    expect(agree(3, "needs", "need")).toBe("need");
  });
});

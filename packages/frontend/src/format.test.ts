import { describe, expect, it } from "vitest";
import {
  agree,
  fileTypeLabel,
  formatDaySpan,
  formatFileSize,
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
});

describe("agree", () => {
  it("picks the verb form for a count", () => {
    expect(agree(1, "fails", "fail")).toBe("fails");
    expect(agree(0, "fails", "fail")).toBe("fail");
    expect(agree(3, "needs", "need")).toBe("need");
  });
});

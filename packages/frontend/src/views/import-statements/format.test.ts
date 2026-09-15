import { describe, expect, it } from "vitest";
import { fileTypeLabel, formatFileSize } from "./format";

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

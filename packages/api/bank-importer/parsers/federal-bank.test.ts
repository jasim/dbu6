import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parse } from "./federal-bank.js";

function writeWorkbook(rows: unknown[][]): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "federal-bank-test-"));
  const file = path.join(dir, "statement.xlsx");
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Statement");
  XLSX.writeFile(workbook, file);
  return { dir, file };
}

const metadataRows = Array.from({ length: 10 }, () => []);

describe("Federal Bank parser", () => {
  it("parses statement rows, normalizes dates, and cleans UPI withdrawal narration", () => {
    const { dir, file } = writeWorkbook([
      ...metadataRows,
      ["Tran Date", "Particulars", "Withdrawal", "Deposit", "Balance Amount"],
      [
        new Date(Date.UTC(2026, 3, 24)),
        "UPIOUT/DR/COFFEE SHOP/12345",
        "1,234.50",
        "",
        "10,000.25",
      ],
      ["03/04/26", "Salary credit", "", "50,000.00", "60,000.25"],
      ["not a date", "ignored", 1, 0, 0],
    ]);

    try {
      expect(parse(file)).toEqual({
        count: 2,
        transactions: [
          {
            date: "2026-04-24",
            narration: "COFFEE SHOP",
            withdrawal: 1234.5,
            deposit: 0,
            balance: 10000.25,
          },
          {
            date: "2026-04-03",
            narration: "Salary credit",
            withdrawal: 0,
            deposit: 50000,
            balance: 60000.25,
          },
        ],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports missing expected statement columns", () => {
    const { dir, file } = writeWorkbook([
      ...metadataRows,
      ["Tran Date", "Particulars", "Withdrawal", "Deposit"],
      ["24/04/2026", "row", 100, 0],
    ]);

    try {
      expect(() => parse(file)).toThrow(
        "Federal parser: missing expected columns Balance Amount",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

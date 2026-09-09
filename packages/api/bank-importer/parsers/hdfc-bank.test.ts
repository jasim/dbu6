import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parse } from "./hdfc-bank.js";

function writeWorkbook(rows: unknown[][]): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "hdfc-bank-test-"));
  const file = path.join(dir, "statement.xls");
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Statement");
  XLSX.writeFile(workbook, file);
  return { dir, file };
}

const metadataRows = Array.from({ length: 20 }, () => []);
const headerRow = [
  "Date",
  "Narration",
  "Chq./Ref.No.",
  "Value Dt",
  "Withdrawal Amt.",
  "Deposit Amt.",
  "Closing Balance",
];

describe("HDFC Bank parser", () => {
  it("parses transactions and extracts opening balance from statement summary", () => {
    const { dir, file } = writeWorkbook([
      ...metadataRows,
      headerRow,
      [
        "********",
        "**********************************",
        "************",
        "********",
        "******************",
        "******************",
        "******************",
      ],
      [
        "01/04/26",
        "IB BILLPAY DR-HDFCSI-050505XXXXXX0505",
        "NONPIIREF0505050",
        "02/04/26",
        1000000,
        "",
        1050505.0,
      ],
      ["STATEMENT SUMMARY  :-"],
      ["Opening Balance", null, null, null, "Debits", "Credits", "Closing Bal"],
      [2050505.0, null, null, null, 1000000, 0, 1050505.0],
    ]);

    try {
      expect(parse(file)).toEqual({
        count: 1,
        openingBalance: 2050505.0,
        transactions: [
          {
            date: "2026-04-01",
            narration: "IB BILLPAY DR-HDFCSI-050505XXXXXX0505",
            withdrawal: 1000000,
            deposit: 0,
            balance: 1050505.0,
          },
        ],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null opening balance when the statement summary is absent", () => {
    const { dir, file } = writeWorkbook([
      ...metadataRows,
      headerRow,
      ["01/04/26", "Salary", "REF", "01/04/26", "", 1000, 1000],
    ]);

    try {
      expect(parse(file).openingBalance).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

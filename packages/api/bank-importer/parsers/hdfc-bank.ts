import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import type { Abacus } from "../domain/Abacus.js";

interface RawRow {
  Date?: string;
  Narration?: string;
  "Withdrawal Amt."?: string;
  "Deposit Amt."?: string;
  "Closing Balance"?: string;
  [key: string]: unknown;
}

export interface HdfcParseResult {
  transactions: Abacus[];
  count: number;
  openingBalance: number | null;
}

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/;

// Parse dd/mm/yy → YYYY-MM-DD. Returns null for non-date strings so the
// caller can skip them — this is how we fall off the end of the transaction
// block into the "STATEMENT SUMMARY" footer without throwing.
// Pivot year: yy < 50 → 20xx, else 19xx.
function parseDate(dateStr: string): string | null {
  const m = DATE_RE.exec(dateStr);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  const year = parseInt(yy, 10);
  const fullYear = year < 50 ? 2000 + year : 1900 + year;
  return `${fullYear}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n =
    typeof value === "number"
      ? value
      : parseFloat(String(value).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n =
    typeof value === "number"
      ? value
      : parseFloat(String(value).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function isOpeningBalanceLabel(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.trim().toLowerCase() === "opening balance"
  );
}

function parseOpeningBalance(sheet: XLSX.WorkSheet): number | null {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  });
  for (let i = 0; i < rows.length - 1; i++) {
    const labelIndex = rows[i].findIndex(isOpeningBalanceLabel);
    if (labelIndex < 0) continue;
    return toOptionalNumber(rows[i + 1][labelIndex]);
  }
  return null;
}

export function parse(filePath: string): HdfcParseResult {
  const buffer = readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("No sheets found in the workbook.");
  }
  const sheet = workbook.Sheets[sheetName];
  const openingBalance = parseOpeningBalance(sheet);

  // Skip first 20 metadata rows; row 21 (0-indexed: 20) becomes the header
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { range: 20 });

  if (rows.length > 0) {
    const required = [
      "Date",
      "Narration",
      "Withdrawal Amt.",
      "Deposit Amt.",
      "Closing Balance",
    ];
    const missing = required.filter((col) => !(col in rows[0]));
    if (missing.length > 0) {
      throw new Error(
        `HDFC parser: missing expected columns ${missing.join(", ")}`,
      );
    }
  }

  const transactions: Abacus[] = [];
  for (const row of rows) {
    const dateVal = String(row.Date ?? "");
    if (dateVal === "" || /^\*+$/.test(dateVal)) continue;
    const date = parseDate(dateVal);
    if (date === null) continue; // non-date rows (footer, stray summary text)
    transactions.push({
      date,
      narration: String(row.Narration ?? ""),
      withdrawal: toNumber(row["Withdrawal Amt."]),
      deposit: toNumber(row["Deposit Amt."]),
      balance: toNumber(row["Closing Balance"]),
    });
  }

  return { transactions, count: transactions.length, openingBalance };
}

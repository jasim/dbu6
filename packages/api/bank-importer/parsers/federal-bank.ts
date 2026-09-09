import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import type { Abacus } from "../domain/Abacus.js";

interface RawRow {
  "Tran Date"?: unknown;
  Particulars?: unknown;
  Withdrawal?: unknown;
  Deposit?: unknown;
  "Balance Amount"?: unknown;
  [key: string]: unknown;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return isNaN(value) ? 0 : value;
  const n = parseFloat(String(value).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "string") {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/.exec(value.trim());
    if (dmy) {
      const [, dd, mm, yy] = dmy;
      const parsedYear = parseInt(yy, 10);
      const year =
        yy.length === 2
          ? parsedYear < 50
            ? 2000 + parsedYear
            : 1900 + parsedYear
          : parsedYear;
      return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }
  }
  return null;
}

function cleanNarration(particulars: string, isWithdrawal: boolean): string {
  if (isWithdrawal && particulars.startsWith("UPIOUT")) {
    const parts = particulars.split("/");
    if (parts.length >= 3) return parts[2];
  }
  return particulars;
}

export function parse(filePath: string): {
  transactions: Abacus[];
  count: number;
} {
  const buffer = readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("No sheets found in the workbook.");
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, {
    range: 10,
    defval: null,
  });

  if (rows.length > 0) {
    const required = [
      "Tran Date",
      "Particulars",
      "Withdrawal",
      "Deposit",
      "Balance Amount",
    ];
    const missing = required.filter((col) => !(col in rows[0]));
    if (missing.length > 0) {
      throw new Error(
        `Federal parser: missing expected columns ${missing.join(", ")}`,
      );
    }
  }

  const transactions: Abacus[] = [];
  for (const row of rows) {
    const date = parseDate(row["Tran Date"]);
    if (date === null) continue;
    const particulars = String(row.Particulars ?? "").trim();
    const withdrawal = toNumber(row.Withdrawal);
    const deposit = toNumber(row.Deposit);
    transactions.push({
      date,
      narration: cleanNarration(particulars, withdrawal > 0),
      withdrawal,
      deposit,
      balance: toNumber(row["Balance Amount"]),
    });
  }

  return { transactions, count: transactions.length };
}

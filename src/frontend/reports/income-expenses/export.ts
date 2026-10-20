import { formatMonth } from "../../report-kit";
import type {
  DateSpan,
  IncomeExpenses,
  IncomeExpensesAccount,
} from "../../../shared/index";
import type { XlsxSheet } from "../../xlsx";
import type { Section } from "./figures";
import { ownMonths } from "./selection";

/*
 * Income and Expenses as a workbook: an Expenses sheet and an Incomes
 * sheet, each a flat list of accounts with no hierarchy. A parent lists
 * only its own entries, so every amount is counted once and the rows add
 * up to the section's total. A period of more than one month gets a column
 * per month before the total.
 */

export function incomeExpensesSheets(report: IncomeExpenses): XlsxSheet[] {
  return [
    sectionSheet("Expenses", report, "spending"),
    sectionSheet("Incomes", report, "income"),
  ];
}

export function incomeExpensesFileName(dates: DateSpan): string {
  return `Income and Expenses ${dates.first_date} to ${dates.last_date}.xlsx`;
}

type FlatAccount = { name: string; months: number[]; total: number };

function sectionSheet(
  name: string,
  report: IncomeExpenses,
  section: Section,
): XlsxSheet {
  const monthly = report.months.length > 1;
  const accounts = flatAccounts(report[section].accounts).sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  );
  const columnTotals = report.months.map((month) => month[section]);
  const amounts = (months: number[], total: number) =>
    monthly ? [...months.map(round), round(total)] : [round(total)];
  return {
    name,
    header: [
      "Account",
      ...(monthly
        ? report.months.map((month) => formatMonth(month.month))
        : []),
      "Total",
    ],
    rows: [
      ...accounts.map((account) => [
        account.name,
        ...amounts(account.months, account.total),
      ]),
      ["Total", ...amounts(columnTotals, report[section].total)],
    ],
    totals: true,
    widths: [
      Math.max(
        12,
        ...accounts.map((account) => Math.min(account.name.length + 2, 60)),
      ),
      ...(monthly ? report.months.map(() => 14) : []),
      16,
    ],
  };
}

/** Every account with entries of its own, out of its tree. */
export function flatAccounts(accounts: IncomeExpensesAccount[]): FlatAccount[] {
  return accounts.flatMap((account) => {
    const own: FlatAccount[] =
      account.own !== 0 || ownMonths(account).some((value) => value !== 0)
        ? [
            {
              name: account.name,
              months: ownMonths(account),
              total: account.own,
            },
          ]
        : [];
    return [...own, ...flatAccounts(account.children)];
  });
}

/** To the paisa, without the float's tail (0.1 + 0.2). */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

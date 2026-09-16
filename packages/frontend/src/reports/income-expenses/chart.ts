import type { DateSpan, IncomeExpenses } from "dbu6-shared";
import { Temporal } from "@sapporta/shared/temporal";
import { formatMonth, monthName } from "../../format";
import { signedAmount } from "./figures";
import { financialYearOf, financialYearSpan } from "../periods";

/*
 * The month-by-month chart's bars (PLAN.md §11 P4): a pair per month, or per
 * financial year once the period runs past 24 months. Each pair knows the
 * dates a click narrows the page to.
 */

export const MOST_MONTHLY_BARS = 24;

export type ChartBar = {
  key: string;
  /** Under the pair: "Mar", or "FY 2024–25". */
  label: string;
  /** Under the label, on the first month and each January. */
  year: string | null;
  /** The bar holding today, while the period ends today. */
  soFar: boolean;
  income: number;
  spending: number;
  /** "March 2026 · Income +₹1,20,000.00 · Spending −₹84,500.00". */
  description: string;
  /** What clicking the pair narrows the page to, never past today. */
  dates: DateSpan;
};

export function chartBars(
  months: IncomeExpenses["months"],
  period: DateSpan,
  today: string,
): ChartBar[] {
  const endsToday = period.last_date === today;
  const thisMonth = today.slice(0, 7);
  if (months.length <= MOST_MONTHLY_BARS) {
    return months.map((row, index) => {
      const month = Temporal.PlainYearMonth.from(row.month);
      const first = month.toPlainDate({ day: 1 });
      return bar({
        key: row.month,
        label: monthName(month.month),
        year: index === 0 || month.month === 1 ? String(month.year) : null,
        name: formatMonth(row.month, "long"),
        soFar: endsToday && row.month === thisMonth,
        income: row.income,
        spending: row.spending,
        dates: upToToday(
          {
            first_date: first.toString(),
            last_date: first.with({ day: first.daysInMonth }).toString(),
          },
          today,
        ),
      });
    });
  }

  const years = new Map<number, { income: number; spending: number }>();
  for (const row of months) {
    const year = financialYearOf(row.month);
    const sums = years.get(year) ?? { income: 0, spending: 0 };
    sums.income += row.income;
    sums.spending += row.spending;
    years.set(year, sums);
  }
  const todaysYear = financialYearOf(thisMonth);
  return Array.from(years, ([year, sums]) => {
    const label = `FY ${year}–${String((year + 1) % 100).padStart(2, "0")}`;
    return bar({
      key: `fy-${year}`,
      label,
      year: null,
      name: label,
      soFar: endsToday && year === todaysYear,
      ...sums,
      dates: upToToday(financialYearSpan(year), today),
    });
  });
}

/** The height every bar shares: the largest income or spending, at least 0. */
export function chartScale(bars: readonly ChartBar[]): number {
  return bars.reduce(
    (largest, { income, spending }) => Math.max(largest, income, spending),
    0,
  );
}

/** A bar's height as a fraction of the chart; a negative amount has none. */
export function barHeight(value: number, scale: number): number {
  return scale > 0 && value > 0 ? value / scale : 0;
}

function bar(
  input: Omit<ChartBar, "description"> & { name: string },
): ChartBar {
  const { name, ...rest } = input;
  return {
    ...rest,
    description: `${name} · Income ${signedAmount("income", input.income)} · Spending ${signedAmount("spending", input.spending)}`,
  };
}

function upToToday(dates: DateSpan, today: string): DateSpan {
  return dates.last_date > today && dates.first_date <= today
    ? { ...dates, last_date: today }
    : dates;
}

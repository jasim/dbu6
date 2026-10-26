import type { DateSpan } from "../../shared/index";
import { Temporal } from "@sapporta/shared/temporal";

/*
 * The periods the reports offer by name, resolved against today each time a
 * screen reads them, and the financial year they count in. Dates are
 * `YYYY-MM-DD` in the workspace's time zone (`today()` in `shared.tsx`);
 * months are `YYYY-MM`. Each screen chooses which presets it shows.
 */

/** Each preset's `months` is its length, which a step moves it by. */
export const PERIOD_PRESETS = [
  { id: "this-month", label: "This month", months: 1 },
  { id: "last-month", label: "Last month", months: 1 },
  { id: "last-3-months", label: "Last 3 months", months: 3 },
  { id: "last-12-months", label: "Last 12 months", months: 12 },
  { id: "this-financial-year", label: "This financial year", months: 12 },
  { id: "last-financial-year", label: "Last financial year", months: 12 },
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number]["id"];

export function presetLabel(preset: PeriodPreset): string {
  return PERIOD_PRESETS.find(({ id }) => id === preset)!.label;
}

export function presetMonths(preset: PeriodPreset): number {
  return PERIOD_PRESETS.find(({ id }) => id === preset)!.months;
}

/** The preset a query string names, if it names one. */
export function parsePreset(value: string | null): PeriodPreset | null {
  return PERIOD_PRESETS.find(({ id }) => id === value)?.id ?? null;
}

// A financial year runs from 1 April to 31 March.
const FINANCIAL_YEAR_START_MONTH = 4;

/**
 * The dates a preset covers on `today`. A period never ends after today, and
 * "last N months" counts this month as one of them.
 */
export function presetSpan(preset: PeriodPreset, today: string): DateSpan {
  const day = Temporal.PlainDate.from(today);
  const thisMonth = day.with({ day: 1 });
  switch (preset) {
    case "this-month":
      return span(thisMonth, day);
    case "last-month": {
      const lastMonth = thisMonth.subtract({ months: 1 });
      return span(lastMonth, monthEnd(lastMonth));
    }
    case "last-3-months":
    case "last-12-months":
      return span(
        thisMonth.subtract({ months: presetMonths(preset) - 1 }),
        day,
      );
    case "this-financial-year":
      return span(financialYearStart(day), day);
    case "last-financial-year": {
      const start = financialYearStart(day);
      return span(start.subtract({ years: 1 }), start.subtract({ days: 1 }));
    }
  }
}

/** The year a month's financial year starts in: March 2026 is in 2025's. */
export function financialYearOf(month: string): number {
  const { year, month: number } = Temporal.PlainYearMonth.from(month);
  return financialYearStartYear(year, number);
}

/** A financial year's dates: 1 April to 31 March. */
export function financialYearSpan(startYear: number): DateSpan {
  const first = Temporal.PlainDate.from({
    year: startYear,
    month: FINANCIAL_YEAR_START_MONTH,
    day: 1,
  });
  return span(first, first.add({ years: 1 }).subtract({ days: 1 }));
}

/** "FY 2024–25" for the year starting April 2024. */
export function financialYearLabel(startYear: number): string {
  return `FY ${startYear}–${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * The dates a query string carries, when both are real calendar dates in
 * order; otherwise null.
 */
export function parseSpan(from: string | null, to: string | null) {
  if (!isDate(from) || !isDate(to) || from > to) return null;
  return { first_date: from, last_date: to } satisfies DateSpan;
}

export function monthEnd(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.with({ day: date.daysInMonth });
}

export function span(
  first: Temporal.PlainDate,
  last: Temporal.PlainDate,
): DateSpan {
  return { first_date: first.toString(), last_date: last.toString() };
}

/** A period never ends after today: one running past it ends today. */
export function upToToday(dates: DateSpan, today: string): DateSpan {
  return dates.last_date > today && dates.first_date <= today
    ? { ...dates, last_date: today }
    : dates;
}

function financialYearStartYear(year: number, month: number): number {
  return month >= FINANCIAL_YEAR_START_MONTH ? year : year - 1;
}

export function financialYearStart(
  date: Temporal.PlainDate,
): Temporal.PlainDate {
  return Temporal.PlainDate.from({
    year: financialYearStartYear(date.year, date.month),
    month: FINANCIAL_YEAR_START_MONTH,
    day: 1,
  });
}

export function isDate(value: string | null): value is string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    Temporal.PlainDate.from(value, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}

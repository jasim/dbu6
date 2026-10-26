import {
  formatDateRange,
  formatDaySpan,
  type PeriodPreset,
  type ReportPeriod,
  writeReportPeriod,
} from "../../report-kit";
import type { DateSpan } from "../../../shared/index";

/*
 * The period Income and Expenses covers (PLAN.md §11 P4), read and written
 * as every report's is (`reports/report-period.ts`), with the page's own
 * default and words. Dates are `YYYY-MM-DD` in the workspace's time zone
 * (`today()` in `reports/shared.tsx`).
 */

/** Twelve bars in the chart, even early in a financial year. */
export const DEFAULT_PRESET: PeriodPreset = "last-12-months";

/**
 * The query string for a new period: it keeps the account in focus, not the
 * selected bar.
 */
export function writePeriod(
  search: URLSearchParams,
  period: ReportPeriod,
): URLSearchParams {
  const kept = new URLSearchParams();
  const account = search.get("account");
  if (account !== null) kept.set("account", account);
  return writeReportPeriod(kept, period, DEFAULT_PRESET);
}

/** Whether the dates fall within one calendar month (the chart then hides). */
export function withinOneMonth({ first_date, last_date }: DateSpan): boolean {
  return first_date.slice(0, 7) === last_date.slice(0, 7);
}

/** The dates under the title: "1 October 2025 – 16 September 2026". */
export function periodHeading(dates: DateSpan): string {
  return formatDaySpan(dates, { withYear: true, months: "long" });
}

/** The empty state's sentence for a period with nothing in it. */
export function emptyPeriodSentence(dates: DateSpan): string {
  return dates.first_date === dates.last_date
    ? `Nothing in your books falls on ${formatDateRange(dates)}.`
    : `Nothing in your books falls between ${formatDateRange(dates, "and")}.`;
}

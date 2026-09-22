import {
  formatDateRange,
  formatDaySpan,
  formatMonthSpan,
  monthEnd,
  parseSpan,
  type PeriodPreset,
  presetLabel,
  presetSpan,
  Temporal,
} from "../../report-kit";
import type { DateSpan } from "../../../shared/index";

/*
 * The period Income and Expenses covers (PLAN.md §11 P4): a preset,
 * resolved against today each time the page reads it, or dates picked on the
 * page or carried by a link. Dates are `YYYY-MM-DD` in the workspace's time
 * zone (`today()` in `reports/shared.tsx`); months are `YYYY-MM`. The presets
 * themselves are the reports' (`reports/periods.ts`).
 */

const PAGE_PRESETS = [
  "this-month",
  "last-month",
  "last-12-months",
  "this-financial-year",
  "last-financial-year",
] as const satisfies readonly PeriodPreset[];

export type Preset = (typeof PAGE_PRESETS)[number];

/** The page's preset buttons, in order. */
export const PRESETS = PAGE_PRESETS.map((id) => ({
  id,
  label: presetLabel(id),
}));

/** Twelve bars in the chart, even early in a financial year. */
export const DEFAULT_PRESET: Preset = "last-12-months";

export type Period =
  | { kind: "preset"; preset: Preset; span: DateSpan }
  | { kind: "picked"; span: DateSpan };

/**
 * The period a query string asks for. Valid `from_date` and `to_date`, in
 * order, win; then a known `period`; otherwise the default preset.
 */
export function readPeriod(search: URLSearchParams, today: string): Period {
  const picked = parseSpan(search.get("from_date"), search.get("to_date"));
  if (picked !== null) return { kind: "picked", span: picked };
  const named = PRESETS.find((preset) => preset.id === search.get("period"));
  const preset = named?.id ?? DEFAULT_PRESET;
  return { kind: "preset", preset, span: presetSpan(preset, today) };
}

/** The query string for a preset: its name, so a bookmark stays relative. */
export function presetSearch(preset: Preset): URLSearchParams {
  return new URLSearchParams({ period: preset });
}

/** The query string for picked dates. */
export function spanSearch(dates: DateSpan): URLSearchParams {
  return new URLSearchParams({
    from_date: dates.first_date,
    to_date: dates.last_date,
  });
}

/**
 * The preset whose button is lit: the chosen one, or for picked dates the
 * first preset that covers exactly those dates today.
 */
export function activePreset(period: Period, today: string): Preset | null {
  if (period.kind === "preset") return period.preset;
  return (
    PRESETS.find(({ id }) => sameSpan(presetSpan(id, today), period.span))
      ?.id ?? null
  );
}

/** Whether the dates fall within one calendar month (the chart then hides). */
export function withinOneMonth({ first_date, last_date }: DateSpan): boolean {
  return first_date.slice(0, 7) === last_date.slice(0, 7);
}

/** The months a span starts and ends in, as the month menus show them. */
export function spanMonths({ first_date, last_date }: DateSpan): {
  from: string;
  to: string;
} {
  return { from: first_date.slice(0, 7), to: last_date.slice(0, 7) };
}

/**
 * The dates of whole picked months: from the 1st of `from` to the last day
 * of `to`, or today when `to` is this month.
 */
export function pickedMonths(
  months: { from: string; to: string },
  today: string,
): DateSpan {
  const first = Temporal.PlainYearMonth.from(months.from).toPlainDate({
    day: 1,
  });
  const lastDay = monthEnd(
    Temporal.PlainYearMonth.from(months.to).toPlainDate({ day: 1 }),
  );
  const day = Temporal.PlainDate.from(today);
  const last =
    Temporal.PlainDate.compare(lastDay, day) > 0 &&
    Temporal.PlainDate.compare(first, day) <= 0
      ? day
      : lastDay;
  return span(first, last);
}

/** Choosing a From after To moves To to it. */
export function pickFrom(
  month: string,
  current: { from: string; to: string },
): { from: string; to: string } {
  return { from: month, to: month > current.to ? month : current.to };
}

/** Choosing a To before From moves From to it. */
export function pickTo(
  month: string,
  current: { from: string; to: string },
): { from: string; to: string } {
  return { from: month < current.from ? month : current.from, to: month };
}

/**
 * The months the menus offer, newest first: from the first month with
 * anything in the books (or the period's first, if earlier) to this month
 * (or the period's last, if later).
 */
export function monthOptions(
  firstMonth: string | null,
  period: DateSpan,
  today: string,
): string[] {
  const { from, to } = spanMonths(period);
  const thisMonth = today.slice(0, 7);
  const oldest = firstMonth !== null && firstMonth < from ? firstMonth : from;
  const newest = to > thisMonth ? to : thisMonth;
  const months: string[] = [];
  for (
    let month = Temporal.PlainYearMonth.from(newest);
    month.toString() >= oldest;
    month = month.subtract({ months: 1 })
  ) {
    months.push(month.toString());
  }
  return months;
}

/** The dates under the title: "1 October 2025 – 16 September 2026". */
export function periodHeading(dates: DateSpan): string {
  return formatDaySpan(dates, { withYear: true, months: "long" });
}

/**
 * What Pick months reads while picked dates are showing: the months, when
 * the dates are whole months ("Mar – Jun 2026"), else the days ("5–20 Mar
 * 2026").
 */
export function pickedLabel(dates: DateSpan, today: string): string {
  const first = Temporal.PlainDate.from(dates.first_date);
  const last = Temporal.PlainDate.from(dates.last_date);
  const wholeMonths =
    first.day === 1 &&
    (last.equals(monthEnd(last)) || dates.last_date === today);
  if (!wholeMonths) return formatDaySpan(dates, { withYear: true });
  const { from, to } = spanMonths(dates);
  return formatMonthSpan(from, to);
}

/** The empty state's sentence for a period with nothing in it. */
export function emptyPeriodSentence(dates: DateSpan): string {
  return dates.first_date === dates.last_date
    ? `Nothing in your books falls on ${formatDateRange(dates)}.`
    : `Nothing in your books falls between ${formatDateRange(dates, "and")}.`;
}

function span(first: Temporal.PlainDate, last: Temporal.PlainDate): DateSpan {
  return { first_date: first.toString(), last_date: last.toString() };
}

function sameSpan(a: DateSpan, b: DateSpan): boolean {
  return a.first_date === b.first_date && a.last_date === b.last_date;
}

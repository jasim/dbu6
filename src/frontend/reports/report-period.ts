import { Temporal } from "@sapporta/shared/temporal";
import type { DateSpan } from "../../shared/index";
import { formatDaySpan, formatMonthSpan } from "../format";
import {
  financialYearOf,
  financialYearSpan,
  financialYearStart,
  isDate,
  monthEnd,
  parsePreset,
  parseSpan,
  PERIOD_PRESETS,
  presetLabel,
  presetSpan,
  type PeriodPreset,
} from "./periods";

/*
 * The period a date-range report covers: everything, a named preset resolved
 * against today, or dates picked on a calendar. It lives in the query string
 * so a bookmark or a shared link opens the same period: a preset by name, so
 * "This month" stays this month, and picked dates as `from_date` and
 * `to_date`, the parameters links into a report already carry.
 */

export type ReportPeriod =
  | { kind: "all-time" }
  | { kind: "preset"; preset: PeriodPreset; span: DateSpan }
  /** `span` is null until both ends are picked. */
  | { kind: "custom"; span: DateSpan | null };

/** The dates a report is asked for; an absent end is unbounded. */
export type ReportDates = { from_date?: string; to_date?: string };

export type PeriodChoice = "all-time" | PeriodPreset | "custom";

/** The period menu, in order. */
export const PERIOD_CHOICES: readonly { value: PeriodChoice; label: string }[] =
  [
    { value: "all-time", label: "All time" },
    ...PERIOD_PRESETS.map(({ id, label }) => ({ value: id, label })),
    { value: "custom", label: "Custom range…" },
  ];

const PERIOD_PARAMS = ["period", "from_date", "to_date"] as const;

/**
 * The period a query string asks for. A lone `to_date` is a balance as of
 * that day, as the balance sheet and the reconciliation reports link to it:
 * its financial year up to that day, which a ledger opens from the balance
 * brought forward. Otherwise any date parameter means picked dates, which
 * count only when both are valid and in order; then a known `period`;
 * otherwise the report's default: all time, which is what a report with no
 * dates has always shown, unless it names a preset.
 */
export function readReportPeriod(
  search: URLSearchParams,
  today: string,
  defaultPreset: PeriodPreset | null = null,
): ReportPeriod {
  const from = search.get("from_date");
  const to = search.get("to_date");
  if (from === null && isDate(to)) {
    const first = financialYearStart(Temporal.PlainDate.from(to)).toString();
    return { kind: "custom", span: { first_date: first, last_date: to } };
  }
  if (from !== null || to !== null) {
    return { kind: "custom", span: parseSpan(from, to) };
  }
  const period = search.get("period");
  if (period === "custom") return { kind: "custom", span: null };
  if (period === "all-time") return { kind: "all-time" };
  const preset = parsePreset(period) ?? defaultPreset;
  return preset === null
    ? { kind: "all-time" }
    : { kind: "preset", preset, span: presetSpan(preset, today) };
}

/**
 * `search` with the period replaced and every other parameter kept. All time
 * is left out of the query string, unless the report defaults to a preset:
 * then it is named, so that choosing it sticks.
 */
export function writeReportPeriod(
  search: URLSearchParams,
  period: ReportPeriod,
  defaultPreset: PeriodPreset | null = null,
): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const key of PERIOD_PARAMS) next.delete(key);
  if (period.kind === "all-time") {
    if (defaultPreset !== null) next.set("period", "all-time");
  } else if (period.kind === "preset") {
    next.set("period", period.preset);
  } else if (period.kind === "custom") {
    if (period.span === null) {
      next.set("period", "custom");
    } else {
      next.set("from_date", period.span.first_date);
      next.set("to_date", period.span.last_date);
    }
  }
  return next;
}

export function reportDates(period: ReportPeriod): ReportDates {
  const span = period.kind === "all-time" ? null : period.span;
  return span === null
    ? {}
    : { from_date: span.first_date, to_date: span.last_date };
}

export function periodChoice(period: ReportPeriod): PeriodChoice {
  return period.kind === "preset" ? period.preset : period.kind;
}

/**
 * The period after choosing from the menu. Custom range starts from the
 * dates on show, so switching to it changes nothing until a date is picked.
 */
export function choosePeriod(
  choice: PeriodChoice,
  current: ReportPeriod,
  today: string,
): ReportPeriod {
  if (choice === "all-time") return { kind: "all-time" };
  if (choice === "custom") {
    return current.kind === "custom"
      ? current
      : {
          kind: "custom",
          span: current.kind === "preset" ? current.span : null,
        };
  }
  return { kind: "preset", preset: choice, span: presetSpan(choice, today) };
}

/**
 * The preset a period reads as: the chosen one, or for picked dates the first
 * preset that covers exactly those dates today, so stepping or picking months
 * onto a preset lights it.
 */
export function activePreset(
  period: ReportPeriod,
  today: string,
): PeriodPreset | null {
  if (period.kind === "preset") return period.preset;
  if (period.kind === "all-time" || period.span === null) return null;
  const { span } = period;
  return (
    PERIOD_PRESETS.find(({ id }) => sameSpan(presetSpan(id, today), span))
      ?.id ?? null
  );
}

/**
 * The period's name on the button: "All time", a preset's label, a
 * financial year ("FY 2024–25"), whole months ("Mar – Jun 2026"), or days
 * ("5–20 Mar 2026").
 */
export function periodLabel(period: ReportPeriod, today: string): string {
  if (period.kind === "all-time") return "All time";
  const preset = activePreset(period, today);
  if (preset !== null) return presetLabel(preset);
  const { span } = period;
  if (span === null) return "Pick dates";
  const year = financialYearOf(span.first_date.slice(0, 7));
  if (sameSpan(span, financialYearSpan(year))) return financialYearLabel(year);
  if (wholeMonths(span, today)) {
    const { from, to } = spanMonths(span);
    return formatMonthSpan(from, to);
  }
  return formatDaySpan(span, { withYear: true });
}

/** "FY 2024–25" for the year starting April 2024. */
export function financialYearLabel(startYear: number): string {
  return `FY ${startYear}–${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * The dates a period covers on a screen that has to name them. All time runs
 * from the books' first day to today, or to their last day if that is later;
 * with nothing in the books, it is today. Null for a custom range still
 * waiting for its dates.
 */
export function periodSpan(
  period: ReportPeriod,
  books: DateSpan | null,
  today: string,
): DateSpan | null {
  if (period.kind !== "all-time") return period.span;
  if (books === null) return { first_date: today, last_date: today };
  return {
    first_date: books.first_date < today ? books.first_date : today,
    last_date: books.last_date > today ? books.last_date : today,
  };
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
  const last = monthEnd(
    Temporal.PlainYearMonth.from(months.to).toPlainDate({ day: 1 }),
  );
  return upToToday(span(first, last), today);
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
 * The months the menus offer, newest first: from the books' first month
 * (or the period's first, if earlier) to this month (or the period's last,
 * if later).
 */
export function monthOptions(
  books: DateSpan | null,
  period: DateSpan | null,
  today: string,
): string[] {
  const thisMonth = today.slice(0, 7);
  const ends = [thisMonth];
  if (books !== null) ends.push(books.first_date.slice(0, 7));
  if (period !== null) ends.push(...Object.values(spanMonths(period)));
  ends.sort();
  const oldest = ends[0]!;
  const newest = ends[ends.length - 1]!;
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

/** How many months each preset steps by. */
const PRESET_MONTHS: Record<PeriodPreset, number> = {
  "this-month": 1,
  "last-month": 1,
  "last-3-months": 3,
  "last-12-months": 12,
  "this-financial-year": 12,
  "last-financial-year": 12,
};

/**
 * The period one step back (-1) or on (+1), the length it is: a month by a
 * month, a financial year by a year, picked months by as many months, and
 * picked days by as many days. A step never starts after today, and ends
 * today at the latest. Null when there is nowhere to step: all time, a range
 * not picked yet, or past today.
 */
export function stepPeriod(
  period: ReportPeriod,
  direction: -1 | 1,
  today: string,
): ReportPeriod | null {
  if (period.kind === "all-time" || period.span === null) return null;
  const first = Temporal.PlainDate.from(period.span.first_date);
  const last = Temporal.PlainDate.from(period.span.last_date);
  const months =
    period.kind === "preset"
      ? PRESET_MONTHS[period.preset]
      : wholeMonths(period.span, today)
        ? monthsFrom(first, last)
        : null;
  let next: DateSpan;
  if (months !== null) {
    const start = first.add({ months: direction * months });
    next = span(
      start,
      monthEnd(start.add({ months: months - 1 }).with({ day: 1 })),
    );
  } else {
    const days = first.until(last).days + 1;
    next = span(
      first.add({ days: direction * days }),
      last.add({ days: direction * days }),
    );
  }
  if (next.first_date > today) return null;
  return { kind: "custom", span: upToToday(next, today) };
}

/**
 * Whether a span is whole months: from a 1st to a month's last day, or to
 * today in this month.
 */
function wholeMonths(dates: DateSpan, today: string): boolean {
  const first = Temporal.PlainDate.from(dates.first_date);
  const last = Temporal.PlainDate.from(dates.last_date);
  return (
    first.day === 1 &&
    (last.equals(monthEnd(last)) || dates.last_date === today)
  );
}

function monthsFrom(first: Temporal.PlainDate, last: Temporal.PlainDate) {
  return (last.year - first.year) * 12 + last.month - first.month + 1;
}

function upToToday(dates: DateSpan, today: string): DateSpan {
  return dates.last_date > today && dates.first_date <= today
    ? { ...dates, last_date: today }
    : dates;
}

function span(first: Temporal.PlainDate, last: Temporal.PlainDate): DateSpan {
  return { first_date: first.toString(), last_date: last.toString() };
}

function sameSpan(a: DateSpan, b: DateSpan): boolean {
  return a.first_date === b.first_date && a.last_date === b.last_date;
}

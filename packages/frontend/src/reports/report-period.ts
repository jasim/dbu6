import type { DateSpan } from "dbu6-shared";
import {
  parsePreset,
  parseSpan,
  PERIOD_PRESETS,
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
 * The period a query string asks for. Any date parameter means picked dates,
 * which count only when both are valid and in order; then a known `period`;
 * otherwise all time, which is what a report with no dates has always shown.
 */
export function readReportPeriod(
  search: URLSearchParams,
  today: string,
): ReportPeriod {
  const from = search.get("from_date");
  const to = search.get("to_date");
  if (from !== null || to !== null) {
    return { kind: "custom", span: parseSpan(from, to) };
  }
  const period = search.get("period");
  if (period === "custom") return { kind: "custom", span: null };
  const preset = parsePreset(period);
  return preset === null
    ? { kind: "all-time" }
    : { kind: "preset", preset, span: presetSpan(preset, today) };
}

/** `search` with the period replaced and every other parameter kept. */
export function writeReportPeriod(
  search: URLSearchParams,
  period: ReportPeriod,
): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const key of PERIOD_PARAMS) next.delete(key);
  if (period.kind === "preset") {
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

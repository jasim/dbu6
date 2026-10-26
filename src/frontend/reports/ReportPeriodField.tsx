import { type ReactNode, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { DayPicker, type ClassNames, type DateRange } from "react-day-picker";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { reportsContract, type DateSpan } from "../../shared/index";
import { Temporal } from "@sapporta/shared/temporal";
import { cn } from "@sapporta/ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  selectTriggerClassName,
} from "../components/ui/select";
import { reportClient } from "../api";
import { formatMonth, formatRelativeDate } from "../format";
import { typingIn } from "../keys";
import { FRESH_QUERY } from "../queries";
import { presetSpan, type PeriodPreset } from "./periods";
import {
  activePreset,
  choosePeriod,
  monthOptions,
  PERIOD_CHOICES,
  periodLabel,
  periodSpan,
  pickedMonths,
  pickFrom,
  pickTo,
  readReportPeriod,
  reportDates,
  spanLabel,
  spanMonths,
  stepPeriod,
  writeReportPeriod,
  type PeriodChoice,
  type ReportPeriod,
} from "./report-period";
import { today } from "./shared";

// Made here, not taken from ./client, which reaches this module through
// report-kit.
const reportsApi = reportClient(reportsContract);

/** The days the books cover, for the month menus and "All time". */
export const booksSpanQuery = queryOptions({
  queryKey: ["reports", "books-span"],
  queryFn: async () => (await reportsApi.booksSpan({ query: {} })).span,
  ...FRESH_QUERY,
});

/**
 * The period in the query string, the dates to ask the report for, and a
 * setter that keeps the other parameters. With no period in the query
 * string it is all time, or `defaultPreset` for a report that would be too
 * long over all time.
 */
export function useReportPeriod({
  defaultPreset = null,
}: { defaultPreset?: PeriodPreset | null } = {}) {
  const [search, setSearch] = useSearchParams();
  const period = readReportPeriod(search, today(), defaultPreset);
  const setPeriod = (next: ReportPeriod) =>
    setSearch((current) => writeReportPeriod(current, next, defaultPreset), {
      replace: true,
    });
  return { period, dates: reportDates(period), setPeriod };
}

/**
 * A report's period: ◂ and ▸ (and `[` and `]`) step it by its own length,
 * and the button between them opens the presets, a pair of month menus over
 * the months the books cover, and a calendar for exact dates. The dates it
 * covers stand beside it, unless the button already names them.
 */
export function ReportPeriodField({
  period,
  onChange,
  showSpan = true,
}: {
  period: ReportPeriod;
  onChange: (period: ReportPeriod) => void;
  /** False on a screen that names the dates itself. */
  showSpan?: boolean;
}) {
  const day = today();
  const books = useQuery(booksSpanQuery).data ?? null;
  const span = periodSpan(period, books, day);
  // Picked days name themselves on the button.
  const dates =
    showSpan && spanLabel(span) !== periodLabel(period, day)
      ? spanLabel(span)
      : null;
  const previous = stepPeriod(period, -1, day);
  const next = stepPeriod(period, 1, day);

  // The listener reads the latest steps without being added again.
  const latest = useRef({ previous, next, onChange });
  latest.current = { previous, next, onChange };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        typingIn(event.target)
      )
        return;
      const { previous, next, onChange } = latest.current;
      const to = event.key === "[" ? previous : event.key === "]" ? next : null;
      if (to === null) return;
      event.preventDefault();
      onChange(to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-row">
      <div className="flex items-center gap-1">
        <StepButton
          to={previous}
          label="Previous period ([)"
          icon={<ChevronLeft className="size-4" aria-hidden="true" />}
          onChange={onChange}
        />
        <PeriodMenu
          period={period}
          books={books}
          today={day}
          onChange={onChange}
        />
        <StepButton
          to={next}
          label="Next period (])"
          icon={<ChevronRight className="size-4" aria-hidden="true" />}
          onChange={onChange}
        />
      </div>
      {dates !== null ? (
        <span className="tnum whitespace-nowrap text-ink-meta">{dates}</span>
      ) : null}
    </div>
  );
}

function StepButton({
  to,
  label,
  icon,
  onChange,
}: {
  to: ReportPeriod | null;
  label: string;
  icon: ReactNode;
  onChange: (period: ReportPeriod) => void;
}) {
  return (
    <button
      type="button"
      disabled={to === null}
      onClick={() => to && onChange(to)}
      aria-label={label}
      title={label}
      className="grid size-(--height-sap-ctl) place-items-center rounded-control text-ink-soft outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40"
    >
      {icon}
    </button>
  );
}

/**
 * The button naming the period, and its popup: the presets, the month
 * menus, and Exact dates, which turns the popup into a range calendar.
 */
function PeriodMenu({
  period,
  books,
  today,
  onChange,
}: {
  period: ReportPeriod;
  books: DateSpan | null;
  today: string;
  onChange: (period: ReportPeriod) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "calendar">("menu");
  const label = periodLabel(period, today);
  const lit: PeriodChoice | null =
    period.kind === "all-time" ? "all-time" : activePreset(period, today);
  const span = periodSpan(period, books, today);
  const months = spanMonths(span);
  const items = monthOptions(books, span, today).map((month) => ({
    value: month,
    label: formatMonth(month),
  }));
  const choose = (next: ReportPeriod) => {
    onChange(next);
    setOpen(false);
  };
  const pick = (next: { from: string; to: string }) =>
    onChange({ kind: "custom", span: pickedMonths(next, today) });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setView("menu");
        setOpen(next);
      }}
    >
      <PopoverTrigger
        aria-label={`Period: ${label}`}
        className={cn(selectTriggerClassName, "w-auto min-w-[180px]")}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-meta" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "rounded-card",
          view === "menu"
            ? "w-[min(300px,calc(100vw-32px))] p-2"
            : "w-auto p-3",
        )}
      >
        {view === "menu" ? (
          <>
            <ul role="list" aria-label="Period">
              {PERIOD_CHOICES.map((choice) => (
                <li key={choice.value}>
                  <button
                    type="button"
                    aria-pressed={choice.value === lit}
                    onClick={() => choose(choosePeriod(choice.value, today))}
                    className={cn(
                      MENU_ROW_CLASS_NAME,
                      choice.value === lit
                        ? "font-semibold text-foreground"
                        : "text-ink-soft",
                    )}
                  >
                    {choice.label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 grid grid-cols-2 gap-3 border-t border-line-inner px-1 pt-3">
              <MonthSelect
                label="From"
                value={months.from}
                items={items}
                onChange={(month) => pick(pickFrom(month, months))}
              />
              <MonthSelect
                label="To"
                value={months.to}
                items={items}
                onChange={(month) => pick(pickTo(month, months))}
              />
            </div>
            <button
              type="button"
              onClick={() => setView("calendar")}
              className={cn(MENU_ROW_CLASS_NAME, "mt-2 gap-2.5 text-ink-soft")}
            >
              <CalendarDays aria-hidden className="size-4 text-ink-meta" />
              Exact dates…
            </button>
          </>
        ) : (
          <RangeCalendar
            span={period.kind === "all-time" ? null : period.span}
            today={today}
            onPick={(picked) => choose({ kind: "custom", span: picked })}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function MonthSelect({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (month: string) => void;
}) {
  return (
    <Select<string>
      value={value}
      items={items}
      onValueChange={(month) => {
        if (month !== null) onChange(month);
      }}
    >
      <div className="space-y-1.5">
        <SelectLabel className="block text-meta text-ink-meta">
          {label}
        </SelectLabel>
        <SelectTrigger placeholder="Month" />
      </div>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Both ends on one calendar. The first click starts a range and the second
 * ends it, in either order, and the popup closes on the second. Closing it
 * after one click keeps the dates it opened with.
 */
function RangeCalendar({
  span,
  today,
  onPick,
}: {
  span: DateSpan | null;
  today: string;
  onPick: (span: DateSpan) => void;
}) {
  const [draft, setDraft] = useState<DateRange | undefined>(
    span === null ? undefined : toRange(span),
  );
  const day = toCalendarDate(today);
  return (
    <DayPicker
      mode="range"
      required
      resetOnSelect
      selected={draft}
      onSelect={(range) => {
        setDraft(range);
        if (range.from && range.to) onPick(toSpan(range.from, range.to));
      }}
      defaultMonth={draft?.from ?? day}
      today={day}
      // The start of a range still waiting for its end looks like an end.
      modifiers={{ start: draft?.from && !draft.to ? draft.from : false }}
      modifiersClassNames={{
        start: `rounded-control ${RANGE_END_CLASS_NAME}`,
      }}
      weekStartsOn={1}
      showOutsideDays
      fixedWeeks
      autoFocus
      classNames={CALENDAR_CLASS_NAMES}
    />
  );
}

/**
 * The day a report stands on: today, the end of last month, the end of last
 * financial year, or a day picked on the calendar; and beside it how far
 * that is from today: a plain "today", the way it is used most, or "6 months
 * ago" lit up, so a figure for another day is never taken for today's.
 */
export function AsOfDateInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const now = today();
  return (
    <div className="flex items-center gap-2 text-row">
      <span className="text-ink-meta">as of:</span>
      <DayField value={value} onChange={onChange} presets={asOfPresets(now)} />
      {value === now ? (
        <span>today</span>
      ) : (
        <span className="rounded-control bg-attention-bg px-2 py-0.5 font-semibold text-attention-ink">
          {formatRelativeDate(value, now)}
        </span>
      )}
    </div>
  );
}

/** The days a balance is usually asked for. */
export function asOfPresets(today: string): { label: string; date: string }[] {
  return [
    { label: "Today", date: today },
    {
      label: "End of last month",
      date: presetSpan("last-month", today).last_date,
    },
    {
      label: "End of last financial year",
      date: presetSpan("last-financial-year", today).last_date,
    },
  ];
}

/**
 * The day a report stands on: a button naming it, opening the usual days
 * (each with its date beside it) and a calendar for any other.
 */
export function DayField({
  value,
  onChange,
  presets,
}: {
  value: string;
  onChange: (value: string) => void;
  presets: readonly { label: string; date: string }[];
}) {
  const [open, setOpen] = useState(false);
  const named = presets.find((preset) => preset.date === value);
  const label = named?.label ?? dayLabel(value);
  const choose = (date: string) => {
    onChange(date);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`As of: ${label}`}
        className={cn(selectTriggerClassName, "w-auto min-w-[180px]")}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-meta" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto rounded-card p-2">
        <ul role="list" aria-label="As of">
          {presets.map((preset) => (
            <li key={preset.label}>
              <button
                type="button"
                aria-pressed={preset.date === value}
                onClick={() => choose(preset.date)}
                className={cn(
                  MENU_ROW_CLASS_NAME,
                  "justify-between gap-6",
                  preset.date === value
                    ? "font-semibold text-foreground"
                    : "text-ink-soft",
                )}
              >
                {preset.label}
                <span className="tnum font-normal text-ink-meta">
                  {dayLabel(preset.date)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 border-t border-line-inner px-1 pt-3">
          <DayPicker
            mode="single"
            required
            selected={toCalendarDate(value)}
            onSelect={(date) => choose(toSpan(date, date).first_date)}
            defaultMonth={toCalendarDate(value)}
            today={toCalendarDate(today())}
            weekStartsOn={1}
            showOutsideDays
            fixedWeeks
            classNames={{
              ...CALENDAR_CLASS_NAMES,
              selected: `rounded-control ${RANGE_END_CLASS_NAME}`,
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A day as the field shows it: "31 Mar 2026". */
function dayLabel(date: string): string {
  return spanLabel({ first_date: date, last_date: date });
}

// The calendar counts plain days; a Date stands in for one at local
// midnight, so its year, month and day read back unchanged.
function toCalendarDate(date: string): Date {
  const { year, month, day } = Temporal.PlainDate.from(date);
  return new Date(year, month - 1, day);
}

function toRange(span: DateSpan): DateRange {
  return {
    from: toCalendarDate(span.first_date),
    to: toCalendarDate(span.last_date),
  };
}

function toSpan(from: Date, to: Date): DateSpan {
  const plain = (date: Date) =>
    Temporal.PlainDate.from({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
    }).toString();
  return { first_date: plain(from), last_date: plain(to) };
}

const MENU_ROW_CLASS_NAME =
  "flex w-full items-center rounded-control px-3 py-2 text-left text-row outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40";

// A picked range is a green band with solid ends, today is bold green, and
// days of the neighbouring months are faint and stay out of the band.
const RANGE_END_CLASS_NAME =
  "not-data-outside:bg-sap-brand-soft not-data-outside:[&>button]:bg-primary not-data-outside:[&>button]:text-primary-foreground not-data-outside:[&>button]:hover:bg-primary-hover";

const CALENDAR_CLASS_NAMES: Partial<ClassNames> = {
  root: "relative",
  months: "relative",
  nav: "absolute inset-x-0 top-0 flex h-8 items-center justify-between",
  button_previous:
    "inline-flex size-8 items-center justify-center rounded-control text-ink-soft outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-disabled:opacity-40",
  button_next:
    "inline-flex size-8 items-center justify-center rounded-control text-ink-soft outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-disabled:opacity-40",
  chevron: "size-4 fill-current",
  month_caption: "flex h-8 items-center justify-center",
  caption_label: "text-row font-semibold text-foreground",
  month_grid: "mt-2 border-separate border-spacing-0",
  weekday: "size-8 text-meta font-normal text-ink-meta",
  day: "size-8 p-0 text-center text-row",
  day_button:
    "tnum size-8 rounded-control text-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40",
  today: "font-semibold not-data-selected:[&>button]:text-primary",
  outside: "[&>button]:text-waiting-marker",
  range_middle: "not-data-outside:bg-sap-brand-soft [&>button]:rounded-none",
  range_start: `rounded-l-control ${RANGE_END_CLASS_NAME}`,
  range_end: `rounded-r-control ${RANGE_END_CLASS_NAME}`,
  disabled: "opacity-40",
  hidden: "invisible",
};

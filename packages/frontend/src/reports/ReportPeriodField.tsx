import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DayPicker, type ClassNames, type DateRange } from "react-day-picker";
import { CalendarDays } from "lucide-react";
import type { DateSpan } from "dbu6-shared";
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
import { formatDaySpan } from "../format";
import {
  choosePeriod,
  PERIOD_CHOICES,
  periodChoice,
  readReportPeriod,
  reportDates,
  writeReportPeriod,
  type PeriodChoice,
  type ReportPeriod,
} from "./report-period";
import { today } from "./shared";

/**
 * The period in the query string, the dates to ask the report for, and a
 * setter that keeps the other parameters.
 */
export function useReportPeriod() {
  const [search, setSearch] = useSearchParams();
  const period = readReportPeriod(search, today());
  const setPeriod = (next: ReportPeriod) =>
    setSearch((current) => writeReportPeriod(current, next), {
      replace: true,
    });
  return { period, dates: reportDates(period), setPeriod };
}

/**
 * A date-range report's period: a menu of presets, with the dates a preset
 * covers beside it, or a field that opens a calendar for a custom range.
 */
export function ReportPeriodField({
  period,
  onChange,
}: {
  period: ReportPeriod;
  onChange: (period: ReportPeriod) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-row">
      <Select<PeriodChoice>
        value={periodChoice(period)}
        items={PERIOD_CHOICES}
        onValueChange={(choice) => {
          if (choice !== null) onChange(choosePeriod(choice, period, today()));
        }}
      >
        <div className="flex items-center gap-2">
          <SelectLabel className="font-normal text-ink-meta">
            period:
          </SelectLabel>
          <SelectTrigger placeholder="Choose a period" className="w-[220px]" />
        </div>
        <SelectContent>
          {PERIOD_CHOICES.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {period.kind === "preset" ? (
        <span className="tnum text-ink-meta">{spanLabel(period.span)}</span>
      ) : null}
      {period.kind === "custom" ? (
        <RangeCalendarField
          span={period.span}
          onPick={(span) => onChange({ kind: "custom", span })}
        />
      ) : null}
    </div>
  );
}

/**
 * One field for both ends. The first click on the calendar starts a range and
 * the second ends it, in either order; the range is kept and the calendar
 * closes on the second. Closing it after one click keeps the dates it opened
 * with.
 */
function RangeCalendarField({
  span,
  onPick,
}: {
  span: DateSpan | null;
  onPick: (span: DateSpan) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const day = toCalendarDate(today());

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(span === null ? undefined : toRange(span));
        setOpen(next);
      }}
    >
      <PopoverTrigger
        aria-label={`Custom range: ${span === null ? "none picked" : spanLabel(span)}`}
        className={cn(selectTriggerClassName, "w-auto justify-start gap-2.5")}
      >
        <CalendarDays aria-hidden className="size-[18px] text-ink-meta" />
        {span === null ? (
          <span className="text-ink-meta">Pick dates</span>
        ) : (
          <span className="tnum whitespace-nowrap">{spanLabel(span)}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto rounded-card p-3">
        <DayPicker
          mode="range"
          required
          resetOnSelect
          selected={draft}
          onSelect={(range) => {
            setDraft(range);
            if (range.from && range.to) {
              onPick(toSpan(range.from, range.to));
              setOpen(false);
            }
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
      </PopoverContent>
    </Popover>
  );
}

/** A span as the field shows it: "1 Apr – 16 Sep 2026". */
function spanLabel(span: DateSpan): string {
  return formatDaySpan(span, { withYear: true });
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

// A picked range is a green band with solid ends, today is bold green, and
// days of the neighbouring months are faint and stay out of the band.
const RANGE_END_CLASS_NAME =
  "not-data-outside:bg-sap-brand-soft not-data-outside:[&>button]:bg-primary not-data-outside:[&>button]:text-primary-foreground not-data-outside:[&>button]:hover:bg-primary-hover";

const CALENDAR_CLASS_NAMES: Partial<ClassNames> = {
  root: "relative",
  months: "relative",
  nav: "absolute inset-x-0 top-0 flex h-10 items-center justify-between",
  button_previous:
    "inline-flex size-10 items-center justify-center rounded-control text-ink-soft outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-disabled:opacity-40",
  button_next:
    "inline-flex size-10 items-center justify-center rounded-control text-ink-soft outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-disabled:opacity-40",
  chevron: "size-4 fill-current",
  month_caption: "flex h-10 items-center justify-center",
  caption_label: "text-row font-semibold text-foreground",
  month_grid: "mt-2 border-separate border-spacing-0",
  weekday: "size-10 text-meta font-normal text-ink-meta",
  day: "size-10 p-0 text-center text-row",
  day_button:
    "tnum size-10 rounded-control text-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40",
  today: "font-semibold not-data-selected:[&>button]:text-primary",
  outside: "[&>button]:text-waiting-marker",
  range_middle: "not-data-outside:bg-sap-brand-soft [&>button]:rounded-none",
  range_start: `rounded-l-control ${RANGE_END_CLASS_NAME}`,
  range_end: `rounded-r-control ${RANGE_END_CLASS_NAME}`,
  disabled: "opacity-40",
  hidden: "invisible",
};

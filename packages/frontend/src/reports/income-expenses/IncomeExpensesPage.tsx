import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { DateSpan, IncomeExpenses } from "dbu6-shared";
import { usePageTitle } from "@sapporta/frontend/shell";
import { cn } from "@sapporta/ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui/popover";
import { apiErrorMessage } from "../../api";
import { EmptyState } from "../../components/empty-state";
import { LoadError } from "../../components/load-error";
import { Screen } from "../../components/screen";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "../../components/ui/select";
import {
  ToggleGroup,
  ToggleGroupItem,
  togglePillClassName,
} from "../../components/ui/toggle-group";
import { formatMonth } from "../../format";
import { incomeExpensesQuery } from "../../queries";
import { today } from "../shared";
import { AccountSection, AccountSectionSkeleton } from "./AccountRows";
import { chartBars } from "./chart";
import { figures, isEmptyPeriod, type Figures } from "./figures";
import { MonthChart, MonthChartSkeleton } from "./MonthChart";
import {
  activePreset,
  emptyPeriodSentence,
  monthOptions,
  periodHeading,
  pickedLabel,
  pickedMonths,
  pickFrom,
  pickTo,
  PRESETS,
  presetSearch,
  readPeriod,
  spanMonths,
  spanSearch,
  withinOneMonth,
  type Period,
  type Preset,
} from "./period";

const TITLE = "Where your money went";

/**
 * Where your money went (PLAN.md §11 P4): where the money came from and
 * where it went over a period, with every account a click away. No primary
 * button; the presets and the rows are the controls.
 */
export function IncomeExpensesPage() {
  usePageTitle(TITLE);
  const [search, setSearch] = useSearchParams();
  const day = today();
  const period = readPeriod(search, day);
  const dates = period.span;
  const query = useQuery(incomeExpensesQuery(dates));
  const report = query.data ?? null;
  const error = query.isError ? apiErrorMessage(query.error) : null;
  // Which rows are open, per section. Not in the URL; a new period keeps
  // the rows that still exist open.
  const [openSpending, setOpenSpending] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [openIncome, setOpenIncome] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  const showDates = (next: DateSpan) => setSearch(spanSearch(next));

  return (
    <Screen
      width="wide"
      header={
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <h1 className="text-title text-foreground">{TITLE}</h1>
            <p className="mt-2 text-body text-ink-meta">
              {periodHeading(dates)}
            </p>
          </div>
          <PeriodControls
            period={period}
            today={day}
            firstMonth={report?.first_month ?? null}
            onPreset={(preset) => setSearch(presetSearch(preset))}
            onDates={showDates}
          />
        </div>
      }
    >
      {error ? (
        <div className="mt-8">
          <LoadError
            title="Couldn't load where your money went"
            message={error}
            retry={() => void query.refetch()}
          />
        </div>
      ) : report === null ? (
        <>
          <FigureTiles figures={null} />
          {!withinOneMonth(dates) && <MonthChartSkeleton />}
          <AccountSectionSkeleton section="spending" />
          <AccountSectionSkeleton section="income" />
        </>
      ) : isEmptyPeriod(report) ? (
        <EmptyState
          className="mt-8"
          title="No income or spending in these months"
          body={emptyPeriodSentence(dates)}
        />
      ) : (
        <PeriodReport
          report={report}
          dates={dates}
          today={day}
          onDates={showDates}
          openSpending={openSpending}
          onOpenSpending={setOpenSpending}
          openIncome={openIncome}
          onOpenIncome={setOpenIncome}
        />
      )}
    </Screen>
  );
}

function PeriodReport({
  report,
  dates,
  today,
  onDates,
  openSpending,
  onOpenSpending,
  openIncome,
  onOpenIncome,
}: {
  report: IncomeExpenses;
  dates: DateSpan;
  today: string;
  onDates: (dates: DateSpan) => void;
  openSpending: ReadonlySet<number>;
  onOpenSpending: (open: ReadonlySet<number>) => void;
  openIncome: ReadonlySet<number>;
  onOpenIncome: (open: ReadonlySet<number>) => void;
}) {
  // While a new period loads, the last one's figures stay, months and all.
  const bars = chartBars(report.months, dates, today);
  const statement = new URLSearchParams({
    from_date: dates.first_date,
    to_date: dates.last_date,
  });
  return (
    <>
      <FigureTiles figures={figures(report)} />
      {!withinOneMonth(dates) && <MonthChart bars={bars} onSelect={onDates} />}
      <AccountSection
        section="spending"
        total={report.spending.total}
        accounts={report.spending.accounts}
        dates={dates}
        open={openSpending}
        onOpenChange={onOpenSpending}
      />
      <AccountSection
        section="income"
        total={report.income.total}
        accounts={report.income.accounts}
        dates={dates}
        open={openIncome}
        onOpenChange={onOpenIncome}
      />
      <div className="mt-6">
        <Button
          render={<Link to={`/reports/income-statement?${statement}`} />}
          nativeButton={false}
          variant="ghost"
        >
          See these figures as an income statement
        </Button>
      </div>
    </>
  );
}

function PeriodControls({
  period,
  today,
  firstMonth,
  onPreset,
  onDates,
}: {
  period: Period;
  today: string;
  firstMonth: string | null;
  onPreset: (preset: Preset) => void;
  onDates: (dates: DateSpan) => void;
}) {
  const lit = activePreset(period, today);
  const months = spanMonths(period.span);
  const options = monthOptions(firstMonth, period.span, today);
  const items = options.map((month) => ({
    value: month,
    label: formatMonth(month),
  }));
  const pick = (next: { from: string; to: string }) =>
    onDates(pickedMonths(next, today));

  return (
    // One row at every width; on a phone it scrolls sideways.
    <div className="-mx-5 max-w-[calc(100%+40px)] overflow-x-auto px-5 pb-1 sm:mx-0 sm:max-w-full sm:px-0">
      <div className="flex w-max gap-2">
        <ToggleGroup<Preset>
          aria-label="Period"
          value={lit === null ? [] : [lit]}
          onValueChange={(value) => {
            // Pressing the lit preset again keeps it.
            const [preset] = value;
            if (preset !== undefined) onPreset(preset);
          }}
        >
          {PRESETS.map((preset) => (
            <ToggleGroupItem<Preset> key={preset.id} value={preset.id}>
              {preset.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Popover>
          <PopoverTrigger
            className={togglePillClassName}
            data-pressed={lit === null ? "" : undefined}
          >
            {lit === null ? pickedLabel(period.span, today) : "Pick months"}
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[min(320px,calc(100vw-32px))] space-y-4 rounded-card p-5"
          >
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
          </PopoverContent>
        </Popover>
      </div>
    </div>
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
      <div className="space-y-2">
        <SelectLabel className="block">{label}</SelectLabel>
        <SelectTrigger placeholder="Choose a month" />
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

function FigureTiles({ figures }: { figures: Figures | null }) {
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-3">
      <FigureTile
        label="Income"
        figure={figures?.income.figure ?? null}
        tone={figures?.income.direction === "out" ? "ink" : "income"}
        line={figures?.income.line}
      />
      <FigureTile
        label="Spending"
        figure={figures?.spending.figure ?? null}
        tone={figures?.spending.direction === "in" ? "income" : "ink"}
        line={figures?.spending.line}
      />
      <FigureTile
        label="Remaining"
        figure={figures?.remaining.figure ?? null}
        tone={figures?.remaining.tone === "overspent" ? "ink" : "kept"}
        line={figures?.remaining.line}
        panel={figures?.remaining.tone === "kept"}
      />
    </div>
  );
}

function FigureTile({
  label,
  figure,
  tone,
  line,
  panel = false,
}: {
  label: string;
  /** Null while it loads. */
  figure: string | null;
  tone: "income" | "ink" | "kept";
  line: string | null | undefined;
  panel?: boolean;
}) {
  return (
    <section
      className={cn(
        "@container rounded-card border px-[22px] py-5 shadow-card",
        panel
          ? "border-money-in-border bg-money-in-bg"
          : "border-sap-border bg-card",
      )}
    >
      <h2 className="text-row font-semibold text-ink-soft">{label}</h2>
      {figure === null ? (
        <div
          aria-hidden="true"
          className="mt-2 h-10 w-3/4 rounded-control bg-sap-nested"
        />
      ) : (
        <p
          className={cn(
            // Display size, shrinking so a crore still fits the tile.
            "tnum mt-1 whitespace-nowrap font-mono text-[min(33px,calc(100cqw/9))] font-semibold leading-tight tracking-[-0.02em]",
            tone === "income" && "text-money-in",
            tone === "ink" && "text-foreground",
            tone === "kept" && "text-money-in-ink",
          )}
        >
          {figure}
        </p>
      )}
      <p className="mt-1 min-h-[20px] text-meta text-ink-meta">
        {figure === null ? null : line}
      </p>
    </section>
  );
}

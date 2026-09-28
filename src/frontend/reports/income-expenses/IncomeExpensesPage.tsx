import {
  apiErrorMessage,
  ChevronDown,
  cn,
  EmptyState,
  formatDaySpan,
  formatMonth,
  FRESH_QUERY,
  incomeStatementHref,
  keepPreviousData,
  Link,
  LoadError,
  Popover,
  PopoverContent,
  PopoverTrigger,
  queryOptions,
  Screen,
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  today,
  usePageTitle,
  useEffect,
  useQuery,
  useRef,
  useSearchParams,
  useState,
} from "../../report-kit";
import { reportsApi } from "../client";
import type { DateSpan, IncomeExpenses } from "../../../shared/index";
import { AccountTable } from "./AccountTable";
import { barByKey, barSeries, chartBars, type ChartBar } from "./chart";
import { EntriesPanel } from "./EntriesPanel";
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
import {
  ancestorIds,
  DEFAULT_FOCUS,
  findAccount,
  ownMonths,
  readFocus,
  sameFocus,
  withBar,
  withFocus,
  type Focus,
} from "./selection";

const TITLE = "Income and Expenses";

/**
 * Income and Expenses for a period. A new period keeps showing the last
 * one's figures until its own arrive, so nothing jumps.
 */
function incomeExpensesQuery(dates: DateSpan) {
  return queryOptions({
    queryKey: ["reports", "income-expenses", dates.first_date, dates.last_date],
    queryFn: () =>
      reportsApi.incomeExpenses({
        query: { from_date: dates.first_date, to_date: dates.last_date },
      }),
    placeholderData: keepPreviousData,
    ...FRESH_QUERY,
  });
}

/**
 * Income and Expenses (PLAN.md §11 P4): where the money came from and
 * where it went over a period. One loop to explore it: select a month in
 * the chart or an account in the table, and the chart, the table and the
 * entries beside it all follow. No primary button; the period, the bars
 * and the rows are the controls, and Esc steps back out.
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

  // A new period keeps the account in focus, not the month.
  const showPeriod = (next: URLSearchParams) => {
    const account = search.get("account");
    if (account !== null) next.set("account", account);
    setSearch(next);
  };

  return (
    <Screen
      width="full"
      header={
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <h1 className="text-title text-foreground">{TITLE}</h1>
            <p className="mt-1 text-body text-ink-meta">
              {periodHeading(dates)}
            </p>
          </div>
          <PeriodMenu
            period={period}
            today={day}
            firstMonth={report?.first_month ?? null}
            onPreset={(preset) => showPeriod(presetSearch(preset))}
            onDates={(next) => showPeriod(spanSearch(next))}
          />
        </div>
      }
    >
      {error ? (
        <div className="mt-5">
          <LoadError
            title="Couldn't load income and expenses"
            message={error}
            retry={() => void query.refetch()}
          />
        </div>
      ) : report === null ? (
        <>
          <FigureLine figures={null} scope={null} />
          {!withinOneMonth(dates) && <MonthChartSkeleton />}
        </>
      ) : isEmptyPeriod(report) ? (
        <EmptyState
          className="mt-5"
          title="No income or spending in these months"
          body={emptyPeriodSentence(dates)}
        />
      ) : (
        <PeriodReport
          report={report}
          dates={dates}
          today={day}
          search={search}
          setSearch={setSearch}
        />
      )}
    </Screen>
  );
}

function PeriodReport({
  report,
  dates,
  today,
  search,
  setSearch,
}: {
  report: IncomeExpenses;
  dates: DateSpan;
  today: string;
  search: URLSearchParams;
  setSearch: (next: URLSearchParams, options?: { replace?: boolean }) => void;
}) {
  // While a new period loads, the last one's figures stay, months and all.
  const bars = chartBars(report.months, dates, today);
  const showChart = !withinOneMonth(dates);
  const selectedBar = showChart ? barByKey(bars, search.get("month")) : null;
  const focus = readFocus(search, report);
  const focusAccount =
    focus.kind === "section"
      ? null
      : findAccount(report[focus.section].accounts, focus.accountId);

  // Which rows are open; not in the URL. An account in focus from a link
  // opens the rows above it once its report arrives.
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const revealed = useRef(false);
  useEffect(() => {
    if (revealed.current || focus.kind === "section") return;
    revealed.current = true;
    const above = ancestorIds(report[focus.section].accounts, focus.accountId);
    if (above.length > 0) setOpen((current) => new Set([...current, ...above]));
  }, [report, focus]);
  const toggle = (accountId: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(accountId)) next.add(accountId);
      return next;
    });

  const setFocus = (next: Focus) =>
    setSearch(withFocus(search, next), { replace: true });
  const setBar = (key: string | null) =>
    setSearch(withBar(search, key), { replace: true });
  const focused = !sameFocus(focus, DEFAULT_FOCUS);

  // Esc steps back out: the account first, then the month.
  const escape = useRef<() => void>(() => {});
  escape.current = () => {
    if (focused) setFocus(DEFAULT_FOCUS);
    else if (selectedBar) setBar(null);
  };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A popover's own Esc closes it, not the focus.
      const { target } = event;
      if (
        target instanceof Element &&
        target.closest("[role=dialog],[role=listbox],[role=menu]")
      )
        return;
      escape.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const scope = selectedBar ?? {
    income: report.income.total,
    spending: report.spending.total,
  };

  return (
    <>
      <FigureLine figures={figures(scope)} scope={selectedBar} />
      {showChart && (
        <MonthChart
          bars={bars}
          selected={selectedBar?.key ?? null}
          onSelect={setBar}
          series={
            focusAccount === null
              ? null
              : {
                  name:
                    focus.kind === "own"
                      ? `${focusAccount.name}, not in a sub-account`
                      : focusAccount.name,
                  section: focus.section,
                  values: barSeries(
                    bars,
                    focus.kind === "own"
                      ? ownMonths(focusAccount)
                      : focusAccount.months,
                  ),
                }
          }
          onClearSeries={() => setFocus(DEFAULT_FOCUS)}
        />
      )}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
        <div className="min-w-0">
          <AccountTable
            report={report}
            bars={bars}
            selectedBar={selectedBar}
            focus={focus}
            onFocus={(next) =>
              setFocus(sameFocus(next, focus) ? DEFAULT_FOCUS : next)
            }
            open={open}
            onToggle={toggle}
          />
          <div className="mt-3 px-1">
            <Link
              to={incomeStatementHref(dates.first_date, dates.last_date)}
              className="text-meta text-ink-meta no-underline hover:text-foreground hover:underline"
            >
              See these figures as an income statement
            </Link>
          </div>
        </div>
        <EntriesPanel
          report={report}
          dates={dates}
          periodLabel={formatDaySpan(dates, { withYear: true })}
          selectedBar={selectedBar}
          focus={focus}
          onClose={focused ? () => setFocus(DEFAULT_FOCUS) : null}
          className={cn(
            // Beside the table, following the scroll; on a narrower screen
            // a sheet over the page while an account is in focus.
            "lg:sticky lg:top-4 lg:max-h-[calc(100vh-32px)]",
            focused
              ? "max-lg:fixed max-lg:inset-x-2 max-lg:top-16 max-lg:bottom-2 max-lg:z-50 max-lg:shadow-sap-elevated"
              : "max-lg:hidden",
          )}
        />
      </div>
    </>
  );
}

/** The period's figures, or the selected bar's, in one line. */
function FigureLine({
  figures,
  scope,
}: {
  figures: Figures | null;
  scope: ChartBar | null;
}) {
  return (
    <dl className="mt-5 flex flex-wrap items-baseline gap-x-8 gap-y-2">
      {scope && (
        <div className="flex items-baseline">
          <dt className="sr-only">Showing</dt>
          <dd className="text-subheading text-foreground">{scope.name}</dd>
        </div>
      )}
      <Figure
        label="Income"
        value={figures?.income.figure}
        className={
          figures?.income.direction === "out"
            ? "text-foreground"
            : "text-money-in"
        }
      />
      <Figure
        label="Spending"
        value={figures?.spending.figure}
        className={
          figures?.spending.direction === "in"
            ? "text-money-in"
            : "text-foreground"
        }
      />
      <Figure
        label={figures?.remaining.tone === "overspent" ? "Overspent" : "Kept"}
        value={figures?.remaining.figure}
        note={figures?.remaining.share ?? null}
        className={
          figures?.remaining.tone === "overspent"
            ? "text-foreground"
            : "text-money-in-ink"
        }
      />
    </dl>
  );
}

function Figure({
  label,
  value,
  note = null,
  className,
}: {
  label: string;
  /** Undefined while it loads. */
  value: string | undefined;
  note?: string | null;
  className: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-meta text-ink-meta">{label}</dt>
      <dd className="flex items-baseline gap-2">
        {value === undefined ? (
          <span
            aria-hidden="true"
            className="inline-block h-6 w-32 rounded-control bg-sap-nested"
          />
        ) : (
          <span
            className={cn(
              "tnum font-mono text-[22px] font-semibold tracking-[-0.01em]",
              className,
            )}
          >
            {value}
          </span>
        )}
        {note && <span className="text-meta text-ink-meta">{note}</span>}
      </dd>
    </div>
  );
}

/**
 * The period: one button naming it, opening the presets and a pair of
 * month menus for any other months.
 */
function PeriodMenu({
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
  const [open, setOpen] = useState(false);
  const lit = activePreset(period, today);
  const months = spanMonths(period.span);
  const items = monthOptions(firstMonth, period.span, today).map((month) => ({
    value: month,
    label: formatMonth(month),
  }));
  const pick = (next: { from: string; to: string }) =>
    onDates(pickedMonths(next, today));
  const label =
    lit === null
      ? pickedLabel(period.span, today)
      : (PRESETS.find((preset) => preset.id === lit)?.label ?? "");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Period: ${label}`}
        className="flex h-9 items-center gap-2 rounded-control border border-sap-border-strong bg-card px-3 text-row font-medium text-foreground shadow-card outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        {label}
        <ChevronDown className="size-4 text-ink-meta" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(300px,calc(100vw-32px))] rounded-card p-2"
      >
        <ul role="list" aria-label="Period">
          {PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                aria-pressed={preset.id === lit}
                onClick={() => {
                  onPreset(preset.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center rounded-control px-3 py-2 text-left text-row outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  preset.id === lit
                    ? "font-semibold text-foreground"
                    : "text-ink-soft",
                )}
              >
                {preset.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 grid grid-cols-2 gap-3 border-t border-line-inner px-1 pt-3 pb-1">
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

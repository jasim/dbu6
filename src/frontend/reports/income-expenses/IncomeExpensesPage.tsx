import {
  apiErrorMessage,
  booksSpanQuery,
  Button,
  cn,
  downloadXlsx,
  EmptyState,
  FileSpreadsheet,
  FRESH_QUERY,
  incomeStatementHref,
  keepPreviousData,
  Link,
  LoadError,
  periodSpan,
  queryOptions,
  readReportPeriod,
  ReportPeriodField,
  type ReportPeriod,
  Screen,
  spanLabel,
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
import { incomeExpensesFileName, incomeExpensesSheets } from "./export";
import { figures, isEmptyPeriod, type Figures } from "./figures";
import { MonthChart, MonthChartSkeleton } from "./MonthChart";
import {
  DEFAULT_PRESET,
  emptyPeriodSentence,
  periodHeading,
  withinOneMonth,
  writePeriod,
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
  const period = readReportPeriod(search, day, DEFAULT_PRESET);
  // All time runs over the days the books cover, so it waits for them.
  const books = useQuery(booksSpanQuery);
  const dates =
    period.kind === "all-time" && books.data === undefined
      ? null
      : periodSpan(period, books.data ?? null, day);
  const query = useQuery({
    ...incomeExpensesQuery(dates ?? { first_date: day, last_date: day }),
    enabled: dates !== null,
  });
  const report = query.data ?? null;
  const error = query.isError
    ? apiErrorMessage(query.error)
    : books.isError
      ? apiErrorMessage(books.error)
      : null;

  // A new period keeps the account in focus, not the month.
  const showPeriod = (next: ReportPeriod) =>
    setSearch(writePeriod(search, next));

  return (
    <Screen
      width="full"
      header={
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <h1 className="text-title text-foreground">{TITLE}</h1>
            <p className="mt-1 text-body text-ink-meta">
              {dates === null ? "\u00a0" : periodHeading(dates)}
            </p>
          </div>
          <ReportPeriodField
            period={period}
            onChange={showPeriod}
            showSpan={false}
          />
        </div>
      }
    >
      {error ? (
        <div className="mt-5">
          <LoadError
            title="Couldn't load income and expenses"
            message={error}
            retry={() => {
              void books.refetch();
              void query.refetch();
            }}
          />
        </div>
      ) : report === null || dates === null ? (
        <>
          <FigureLine className="mt-5" figures={null} scope={null} />
          {(dates === null || !withinOneMonth(dates)) && <MonthChartSkeleton />}
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
          loading={query.isPlaceholderData}
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
  loading,
  search,
  setSearch,
}: {
  report: IncomeExpenses;
  dates: DateSpan;
  today: string;
  /** Whether the figures are still the last period's, while it loads. */
  loading: boolean;
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
      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
        <FigureLine figures={figures(scope)} scope={selectedBar} />
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() =>
            downloadXlsx(
              incomeExpensesFileName(dates),
              incomeExpensesSheets(report),
            )
          }
        >
          <FileSpreadsheet aria-hidden="true" />
          Export to Excel
        </Button>
      </div>
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
          periodLabel={spanLabel(dates)}
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
  className,
}: {
  figures: Figures | null;
  scope: ChartBar | null;
  className?: string;
}) {
  return (
    <dl
      className={cn("flex flex-wrap items-baseline gap-x-8 gap-y-2", className)}
    >
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
        label={figures?.remaining.tone === "overspent" ? "Overspent" : "Saved"}
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

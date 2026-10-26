import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, CreditCard, Landmark } from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@sapporta/frontend/auth";
import { usePageTitle } from "@sapporta/frontend/shell";
import type { HomeSummary, PostedOverview } from "../../shared/index";
import { apiErrorMessage, overviewApi } from "../api";
import { LoadError } from "../components/load-error";
import { Screen } from "../components/screen";
import { formatDate, formatMoney, formatMonth } from "../format";
import { FRESH_QUERY, homeSummaryQuery } from "../queries";
import { chartBars } from "../reports/income-expenses/chart";
import { figures, signedAmount } from "../reports/income-expenses/figures";
import { MonthChart } from "../reports/income-expenses/MonthChart";
import {
  accountLedgerHref,
  balanceSheetHref,
  incomeExpensesHref,
} from "../reports/links";
import { today } from "../reports/shared";
import { UPDATE_ROUTE } from "../update/routes";
import { StepCard } from "../update/Update";
import {
  FIRST_RUN_GREETING,
  updateState,
  waitingInUpdate,
} from "../update/state";
import {
  averageLabel,
  categoryRows,
  difference,
  monthDates,
  type MonthTotals,
  monthSteps,
  netWorthChange,
  savedShareDifference,
  waitingLabel,
} from "./state";

/**
 * Overview: where the money stands for one month, from posted entries only.
 * Until anything is posted it shows the first run's card instead, the one
 * Update shows, so a new user starts with setup.
 */
export function Overview() {
  usePageTitle("Overview");
  const [search, setSearch] = useSearchParams();
  const asked = search.get("month");
  const summaryQuery = useQuery(homeSummaryQuery);
  const summary = summaryQuery.data ?? null;
  const overviewQuery = useQuery({
    queryKey: ["overview", asked],
    queryFn: () =>
      overviewApi.overview({ query: asked ? { month: asked } : {} }),
    // The month just left stays up while the next one loads.
    placeholderData: keepPreviousData,
    ...FRESH_QUERY,
  });
  const overview = overviewQuery.data ?? null;
  const failed = summaryQuery.isError
    ? summaryQuery.error
    : overviewQuery.isError
      ? overviewQuery.error
      : null;
  const setMonth = (month: string) =>
    setSearch((current) => {
      const next = new URLSearchParams(current);
      next.set("month", month);
      return next;
    });

  if (summary && overview && !overview.posted) {
    return <FirstRun summary={summary} />;
  }

  return (
    <Screen
      width="wide"
      header={
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-title text-foreground sm:text-display">
            Overview
          </h1>
          {overview?.posted && (
            <MonthPicker overview={overview} onPick={setMonth} />
          )}
        </div>
      }
    >
      {failed ? (
        <div className="mt-5">
          <LoadError
            title="Couldn't load the overview"
            message={apiErrorMessage(failed)}
            retry={() => {
              void summaryQuery.refetch();
              void overviewQuery.refetch();
            }}
          />
        </div>
      ) : summary && overview?.posted ? (
        <div className="mt-5 space-y-4">
          <StatusLine summary={summary} overview={overview} />
          <MonthFigures overview={overview} />
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <Categories overview={overview} />
            <NetWorth overview={overview} />
          </div>
          <MonthChart
            bars={chartBars(
              overview.months,
              {
                first_date: monthDates(overview.months[0].month).first_date,
                last_date: monthDates(overview.month).last_date,
              },
              today(),
            )}
            selected={overview.month}
            onSelect={(month) => month && setMonth(month)}
            series={null}
            onClearSeries={() => {}}
            alwaysSelected
          />
          <Accounts overview={overview} />
        </div>
      ) : (
        <div aria-hidden="true" className="mt-5 space-y-4">
          <div className="h-[132px] rounded-card border border-sap-border bg-card" />
          <div className="h-[260px] rounded-card border border-sap-border bg-card" />
        </div>
      )}
    </Screen>
  );
}

/**
 * Before anything is posted: the first run's card, under its greeting even
 * while the first drafts wait, where Update would say "Update your books".
 */
function FirstRun({ summary }: { summary: HomeSummary }) {
  const workspaceName = useAuthStore((s) =>
    s.session.kind === "authenticated"
      ? s.session.context.workspace.name
      : null,
  );
  const view = updateState(summary);
  return (
    <Screen
      width="narrow"
      header={
        <>
          <h1 className="text-title text-foreground sm:text-display">
            {FIRST_RUN_GREETING}
          </h1>
          {workspaceName && (
            <p className="mt-2 text-body text-ink-meta">{workspaceName}</p>
          )}
        </>
      }
    >
      <div className="mt-5">
        <StepCard card={view.card} />
      </div>
    </Screen>
  );
}

/** ◂ April 2026 ▸, bounded by the books' first month and this month. */
function MonthPicker({
  overview,
  onPick,
}: {
  overview: PostedOverview;
  onPick: (month: string) => void;
}) {
  const steps = monthSteps(overview.month, overview.first_month, today());
  const step = (
    to: string | null,
    label: string,
    icon: ReactNode,
  ) => (
    <button
      type="button"
      disabled={to === null}
      onClick={() => to && onPick(to)}
      aria-label={label}
      title={label}
      className="grid size-(--height-sap-ctl) place-items-center rounded-control text-ink-soft outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40"
    >
      {icon}
    </button>
  );
  return (
    <div className="flex items-center gap-1">
      {step(
        steps.previous,
        "Previous month",
        <ChevronLeft className="size-4" aria-hidden="true" />,
      )}
      <span className="min-w-[136px] text-center text-heading text-foreground">
        {formatMonth(overview.month, "long")}
      </span>
      {step(
        steps.next,
        "Next month",
        <ChevronRight className="size-4" aria-hidden="true" />,
      )}
    </div>
  );
}

/**
 * How complete the books are, and what waits in Update. Hidden when there
 * is neither a balance check nor anything waiting.
 */
function StatusLine({
  summary,
  overview,
}: {
  summary: HomeSummary;
  overview: PostedOverview;
}) {
  const waiting = waitingLabel(waitingInUpdate(summary));
  if (overview.complete_until === null && waiting === null) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-card border border-sap-border bg-card px-4 py-3">
      {overview.complete_until !== null && (
        <div className="flex items-baseline gap-3">
          <span className="text-label uppercase text-ink-meta">
            Complete until
          </span>
          <span className="tnum font-mono text-row text-foreground">
            {formatDate(overview.complete_until)}
          </span>
        </div>
      )}
      {waiting !== null && (
        <Link
          to={UPDATE_ROUTE}
          className="inline-flex items-center gap-1 text-row font-semibold text-attention-ink no-underline hover:underline hover:underline-offset-4"
        >
          {waiting}
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/**
 * The month's income, spending and savings beside the usual ones and the
 * difference: a row per figure, so a phone has room for the two columns it
 * keeps.
 */
function MonthFigures({ overview }: { overview: PostedOverview }) {
  const { average } = overview.figures;
  const dates = monthDates(overview.month);
  const current = figures(overview.figures);
  const usual = average && figures(average);
  return (
    <Card>
      <table className="w-full text-row">
        <thead>
          <tr className="text-meta text-ink-meta">
            <th className="w-full pb-2 text-left font-normal" />
            <Th>
              <Link
                to={incomeExpensesHref(dates.first_date, dates.last_date)}
                className="text-row font-semibold text-foreground no-underline hover:underline hover:underline-offset-4"
              >
                {formatMonth(overview.month, "long")}
              </Link>
            </Th>
            {average && <Th>{averageLabel(average.months)}</Th>}
            {average && <Th className={WIDE_ONLY}>Difference</Th>}
          </tr>
        </thead>
        <tbody>
          {FIGURE_ROWS.map((row) => (
            <tr key={row.label} className="border-t border-line-inner">
              <td className="whitespace-nowrap py-2 pr-3 text-ink-soft">
                {row.label}
              </td>
              <Td
                className={
                  row.label === "Income" && current.income.direction === "in"
                    ? "text-money-in"
                    : "text-foreground"
                }
              >
                {row.value(current)}
              </Td>
              {usual && <Td className="text-ink-soft">{row.value(usual)}</Td>}
              {average && (
                <Td className={cn(WIDE_ONLY, "text-ink-soft")}>
                  {row.difference(overview.figures, average)}
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

type Shown = ReturnType<typeof figures>;

/** Each figure, shown, and its difference from the average. */
const FIGURE_ROWS: readonly {
  label: string;
  value: (shown: Shown) => string;
  difference: (month: MonthTotals, average: MonthTotals) => string | null;
}[] = [
  {
    label: "Income",
    value: (shown) => shown.income.figure,
    difference: (month, average) => difference(month.income, average.income),
  },
  {
    label: "Spent",
    value: (shown) => shown.spending.figure,
    difference: (month, average) =>
      difference(-month.spending, -average.spending),
  },
  {
    label: "Saved",
    value: (shown) =>
      shown.remaining.tone === "saved"
        ? shown.remaining.figure
        : `${shown.remaining.figure} over`,
    difference: (month, average) =>
      difference(
        month.income - month.spending,
        average.income - average.spending,
      ),
  },
  {
    label: "Saved %",
    value: (shown) => shown.remaining.share ?? "—",
    difference: savedShareDifference,
  },
];

/** A column a phone leaves out. */
const WIDE_ONLY = "hidden sm:table-cell";

/**
 * The month's largest spending categories beside their usual amounts, then
 * the rest and the total, so the table adds up to Spent.
 */
function Categories({ overview }: { overview: PostedOverview }) {
  const dates = monthDates(overview.month);
  const averaged = overview.figures.average !== null;
  return (
    <Card
      title="Spending by category"
      action={
        <Link
          to={incomeExpensesHref(dates.first_date, dates.last_date)}
          className="text-meta font-semibold text-primary no-underline hover:underline hover:underline-offset-4"
        >
          Income &amp; expenses
        </Link>
      }
    >
      {overview.categories.length === 0 ? (
        <p className="text-row text-ink-meta">
          No spending in {formatMonth(overview.month, "long")}.
        </p>
      ) : (
        <table className="w-full text-row">
          <thead>
            <tr className="text-meta text-ink-meta">
              <th className="w-full pb-2 text-left font-normal">Category</th>
              <Th>{formatMonth(overview.month)}</Th>
              {averaged && <Th>Average</Th>}
              {averaged && <Th className={WIDE_ONLY}>Difference</Th>}
            </tr>
          </thead>
          <tbody>
            {categoryRows(overview).map((row) => {
              const total = row.kind === "total";
              return (
                <tr
                  key={row.account_id ?? row.kind}
                  className={cn(
                    "border-t",
                    total ? "border-sap-border-strong" : "border-line-inner",
                  )}
                >
                  <td
                    className={cn(
                      "max-w-0 truncate py-2 pr-3",
                      total
                        ? "font-semibold text-foreground"
                        : row.kind === "other"
                          ? "text-ink-soft"
                          : "text-foreground",
                    )}
                  >
                    {row.name}
                  </td>
                  <Td
                    className={
                      total ? "font-semibold text-foreground" : "text-foreground"
                    }
                  >
                    {signedAmount("spending", row.amount)}
                  </Td>
                  {averaged && (
                    <Td className="text-ink-soft">
                      {row.average === null
                        ? "—"
                        : signedAmount("spending", row.average)}
                    </Td>
                  )}
                  {averaged && (
                    <Td className={cn(WIDE_ONLY, "text-ink-soft")}>
                      {difference(
                        -row.amount,
                        row.average === null ? null : -row.average,
                      ) ?? "—"}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** What is owned, owed and left at the month's end. */
function NetWorth({ overview }: { overview: PostedOverview }) {
  const { net_worth: worth } = overview;
  const change = netWorthChange(overview);
  const asOf = monthDates(overview.month).last_date;
  return (
    <Card
      title="Net worth"
      action={
        <Link
          to={balanceSheetHref(asOf)}
          className="text-meta font-semibold text-primary no-underline hover:underline hover:underline-offset-4"
        >
          Balance sheet
        </Link>
      }
    >
      <table className="w-full text-row">
        <tbody>
          <WorthRow label="Assets" value={formatMoney(worth.assets)} />
          <WorthRow label="Liabilities" value={formatMoney(worth.liabilities)} />
          <WorthRow
            label={`On ${formatDate(asOf)}`}
            value={formatMoney(worth.net)}
            strong
          />
          <WorthRow
            label={change.label}
            value={signedAmount("income", change.value)}
            className={change.value > 0 ? "text-money-in" : undefined}
          />
        </tbody>
      </table>
    </Card>
  );
}

function WorthRow({
  label,
  value,
  strong = false,
  className,
}: {
  label: string;
  value: string;
  strong?: boolean;
  className?: string;
}) {
  return (
    <tr className="border-t border-line-inner first:border-t-0">
      <td
        className={cn(
          "py-2 pr-3",
          strong ? "font-semibold text-foreground" : "text-ink-soft",
        )}
      >
        {label}
      </td>
      <Td
        className={cn(
          strong ? "font-semibold text-foreground" : "text-foreground",
          className,
        )}
      >
        {value}
      </Td>
    </tr>
  );
}

/** Each bank and card: its balance at the month's end and how far it goes. */
function Accounts({ overview }: { overview: PostedOverview }) {
  if (overview.accounts.length === 0) return null;
  const asOf = monthDates(overview.month).last_date;
  return (
    <Card title={`Accounts on ${formatDate(asOf)}`}>
      <table className="w-full text-row">
        <thead>
          <tr className="text-meta text-ink-meta">
            <th className="w-full pb-2 text-left font-normal">Account</th>
            <Th>Balance</Th>
            <Th className="hidden sm:table-cell">Books until</Th>
          </tr>
        </thead>
        <tbody>
          {overview.accounts.map((account) => {
            const Icon = account.kind === "card" ? CreditCard : Landmark;
            const ledger = accountLedgerHref(account.account_id);
            return (
              <tr
                key={account.account_id}
                className="border-t border-line-inner hover:bg-sap-row-hover"
              >
                <td className="max-w-0 py-2 pr-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon
                      className="size-4 shrink-0 text-ink-meta"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      {ledger ? (
                        <Link
                          to={ledger}
                          className="block truncate font-semibold text-foreground no-underline hover:underline hover:underline-offset-4"
                        >
                          {account.name}
                        </Link>
                      ) : (
                        <span className="block truncate font-semibold">
                          {account.name}
                        </span>
                      )}
                      {/* On a phone the date goes under the name. */}
                      <span className="block text-meta text-ink-meta sm:hidden">
                        Books until {booksUntil(account.books_until)}
                      </span>
                    </span>
                  </span>
                </td>
                <Td className="text-foreground">
                  {account.kind === "card"
                    ? `${formatMoney(account.balance)} owed`
                    : formatMoney(account.balance)}
                </Td>
                <Td className="hidden text-ink-soft sm:table-cell">
                  {booksUntil(account.books_until)}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function booksUntil(date: string | null): string {
  return date === null ? "—" : formatDate(date);
}

function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-sap-border bg-card px-4 py-4 shadow-card">
      {title && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-heading text-foreground">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function Th({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "whitespace-nowrap pb-2 pl-6 text-right font-normal",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "tnum whitespace-nowrap py-2 pl-6 text-right font-mono",
        className,
      )}
    >
      {children}
    </td>
  );
}

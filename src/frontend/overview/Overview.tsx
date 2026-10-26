import { type ReactNode, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, CreditCard, Landmark } from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@sapporta/frontend/auth";
import { usePageTitle } from "@sapporta/frontend/shell";
import type {
  HomeSummary,
  OverviewWorthGroup,
  PostedOverview,
} from "../../shared/index";
import { apiErrorMessage, overviewApi } from "../api";
import { LoadError } from "../components/load-error";
import { Screen } from "../components/screen";
import { formatDate, formatMoney, formatMonth } from "../format";
import { typingIn } from "../keys";
import { formatAmount } from "../report-kit";
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
  categoryBars,
  categoryRows,
  monthDates,
  monthForKey,
  monthSteps,
  otherWorthChange,
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
          <StatusLine summary={summary} />
          <MonthFigures overview={overview} />
          {/* Where the month's money went on the left, where it stands on the right. */}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="min-w-0 space-y-4">
              <Categories overview={overview} />
            </div>
            <div className="min-w-0 space-y-4">
              <NetWorth overview={overview} />
              <Accounts overview={overview} />
            </div>
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
            spendingAverage={
              overview.figures.average && {
                label: averageLabel(overview.figures.average.months),
                value: overview.figures.average.spending,
              }
            }
          />
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

/**
 * ◂ April 2026 ▸, bounded by the books' first month and this month; `[` and
 * `]` step it too.
 */
function MonthPicker({
  overview,
  onPick,
}: {
  overview: PostedOverview;
  onPick: (month: string) => void;
}) {
  const steps = monthSteps(overview.month, overview.first_month, today());
  // The listener reads the latest steps without being added again.
  const latest = useRef({ steps, onPick });
  latest.current = { steps, onPick };
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
      const to = monthForKey(event.key, latest.current.steps);
      if (to === null) return;
      event.preventDefault();
      latest.current.onPick(to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const step = (to: string | null, label: string, icon: ReactNode) => (
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
        "Previous month ([)",
        <ChevronLeft className="size-4" aria-hidden="true" />,
      )}
      <span className="min-w-[136px] text-center text-heading text-foreground">
        {formatMonth(overview.month, "long")}
      </span>
      {step(
        steps.next,
        "Next month (])",
        <ChevronRight className="size-4" aria-hidden="true" />,
      )}
    </div>
  );
}

/** Whether a key goes to a field, a menu or a dialog rather than the page. */
/** What waits in Update. Hidden when nothing does. */
function StatusLine({ summary }: { summary: HomeSummary }) {
  const waiting = waitingLabel(waitingInUpdate(summary));
  if (waiting === null) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-card border border-sap-border bg-card px-4 py-3">
      <Link
        to={UPDATE_ROUTE}
        className="inline-flex items-center gap-1 text-row font-semibold text-attention-ink no-underline hover:underline hover:underline-offset-4"
      >
        {waiting}
        <ChevronRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * The month's income, spending and savings across one row, the usual ones in
 * the row below, so each figure reads beside the one it makes up. It runs the
 * page's width, and scrolls sideways where even that is too narrow.
 */
function MonthFigures({ overview }: { overview: PostedOverview }) {
  const { average } = overview.figures;
  const dates = monthDates(overview.month);
  const current = figures(overview.figures);
  const usual = average && figures(average);
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-row">
          <thead>
            <tr className="text-meta text-ink-meta">
              <th className="w-full pb-2 text-left font-normal" />
              <Th>Income</Th>
              <Th>Spent</Th>
              <Th>Saved</Th>
              <Th>Saved %</Th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line-inner">
              <td className="whitespace-nowrap py-2 pr-3">
                <Link
                  to={incomeExpensesHref(dates.first_date, dates.last_date)}
                  className="font-semibold text-foreground no-underline hover:underline hover:underline-offset-4"
                >
                  {formatMonth(overview.month, "long")}
                </Link>
              </td>
              <Td
                className={
                  current.income.direction === "in"
                    ? "text-money-in"
                    : "text-foreground"
                }
              >
                {current.income.figure}
              </Td>
              <Td className="text-foreground">{current.spending.figure}</Td>
              <Td className="text-foreground">{savedFigure(current)}</Td>
              <Td className="text-foreground">
                {current.remaining.share ?? "—"}
              </Td>
            </tr>
            {average && usual && (
              <tr className="border-t border-line-inner text-ink-soft">
                <td className="whitespace-nowrap py-2 pr-3">
                  {averageLabel(average.months)}
                </td>
                <Td>{usual.income.figure}</Td>
                <Td>{usual.spending.figure}</Td>
                <Td>{savedFigure(usual)}</Td>
                <Td>{usual.remaining.share ?? "—"}</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Saved, or by how much spending went over income. */
function savedFigure(shown: ReturnType<typeof figures>): string {
  return shown.remaining.tone === "saved"
    ? shown.remaining.figure
    : `${shown.remaining.figure} over`;
}

/**
 * The month's largest spending categories beside their usual amounts, then
 * the rest and the total, so the table adds up to Spent.
 */
function Categories({ overview }: { overview: PostedOverview }) {
  const dates = monthDates(overview.month);
  // A category's name opens its month-by-month chart over the twelve months
  // shown here; its amount opens its entries for the month.
  const trend = {
    first_date: monthDates(overview.months[0].month).first_date,
    last_date: dates.last_date,
  };
  const averaged = overview.figures.average !== null;
  const rows = categoryRows(overview);
  const bars = categoryBars(rows);
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
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const total = row.kind === "total";
              const bar = bars[index];
              const ledger =
                row.account_id === null
                  ? null
                  : accountLedgerHref(row.account_id, {
                      from_date: dates.first_date,
                      to_date: dates.last_date,
                    });
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
                      "max-w-0",
                      row.account_id === null && "py-2 pr-3",
                      total
                        ? "font-semibold text-foreground"
                        : row.kind === "other"
                          ? "text-ink-soft"
                          : "text-foreground",
                    )}
                  >
                    {row.account_id === null ? (
                      <CategoryName
                        name={row.name}
                        bar={bar}
                        soft={row.kind === "other"}
                      />
                    ) : (
                      <Link
                        to={incomeExpensesHref(
                          trend.first_date,
                          trend.last_date,
                          { accountId: row.account_id, month: overview.month },
                        )}
                        className={cn(CELL_LINK, "-ml-2 py-2 pl-2 pr-3")}
                      >
                        <CategoryName
                          name={row.name}
                          bar={bar}
                          soft={row.kind === "other"}
                        />
                      </Link>
                    )}
                  </td>
                  <Td
                    className={cn(
                      total
                        ? "font-semibold text-foreground"
                        : "text-foreground",
                      ledger !== null && "p-0",
                    )}
                  >
                    {ledger === null ? (
                      spent(row.amount)
                    ) : (
                      <Link
                        to={ledger}
                        className={cn(CELL_LINK, "-mr-2 py-2 pl-6 pr-2")}
                      >
                        {spent(row.amount)}
                      </Link>
                    )}
                  </Td>
                  {averaged && (
                    <Td className="text-ink-soft">
                      {row.average === null ? "—" : spent(row.average)}
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

/** A category's name, and under it its share of the month. */
function CategoryName({
  name,
  bar,
  soft,
}: {
  name: string;
  bar: ReturnType<typeof categoryBars>[number];
  soft: boolean;
}) {
  return (
    <>
      <span className="block truncate">{name}</span>
      {bar && (
        <SpendBar amount={bar.amount} average={bar.average} soft={soft} />
      )}
    </>
  );
}

/**
 * A category's share of the month under its name: a bar for this month and
 * a tick at the average, on one scale across the table, like the chart's
 * dashed average line. The figures stay in their columns.
 */
function SpendBar({
  amount,
  average,
  soft,
}: {
  amount: number;
  average: number | null;
  // Other's bar is lighter, as its name is.
  soft: boolean;
}) {
  return (
    <span aria-hidden="true" className="relative mt-1 block h-1.5">
      {amount > 0 && (
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            // A sliver stays visible; nothing at all draws nothing.
            width: `max(2px, ${amount * 100}%)`,
            background: soft ? "var(--spend-least)" : "var(--spend-most)",
          }}
        />
      )}
      {average !== null && (
        <span
          className="absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
          style={{ left: `${average * 100}%` }}
        />
      )}
    </span>
  );
}

/** A spending amount, signed; nothing spent reads "0.00", not "−0.00". */
function spent(amount: number): string {
  return amount === 0 ? formatMoney(0) : signedAmount("spending", amount);
}

/**
 * What is owned, less what is owed, at the month's end, each with where it
 * sits. Saved is the month's change in net worth, so the change shows only
 * for what moved it besides income and spending.
 */
function NetWorth({ overview }: { overview: PostedOverview }) {
  const { net_worth: worth } = overview;
  const other = otherWorthChange(overview);
  const asOf = monthDates(overview.month).last_date;
  const ledger = (group: OverviewWorthGroup) =>
    group.account_id === null
      ? null
      : accountLedgerHref(group.account_id, { to_date: asOf });
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
          {worth.asset_groups.map((group) => (
            <WorthRow
              key={group.account_id ?? "other"}
              label={group.name}
              value={formatMoney(group.amount)}
              href={ledger(group)}
              group
            />
          ))}
          <WorthRow label="Less liabilities" value={owed(worth.liabilities)} />
          {worth.liability_groups.map((group) => (
            <WorthRow
              key={group.account_id ?? "other"}
              label={group.name}
              value={owed(group.amount)}
              href={ledger(group)}
              group
            />
          ))}
          <WorthRow
            label={`On ${formatDate(asOf)}`}
            value={formatMoney(worth.net)}
            strong
          />
          {other !== 0 && (
            <WorthRow
              label={`Opening balances and equity in ${formatMonth(overview.month)}`}
              value={signedAmount("income", other)}
            />
          )}
        </tbody>
      </table>
    </Card>
  );
}

/** An amount owed, taken away: "−2,19,305.00". */
function owed(amount: number): string {
  if (amount === 0) return formatMoney(0);
  return formatAmount(amount, amount > 0 ? "out" : "in");
}

function WorthRow({
  label,
  value,
  href = null,
  group = false,
  strong = false,
}: {
  label: string;
  value: string;
  // Where a group's row leads: its ledger up to the month's end.
  href?: string | null;
  // A group under Assets or Liabilities: indented, and lighter.
  group?: boolean;
  strong?: boolean;
}) {
  const ink = strong
    ? "font-semibold text-foreground"
    : group
      ? "text-ink-soft"
      : "text-foreground";
  const labelPad = cn("pr-3", group ? "py-1 pl-4" : "py-2");
  const valuePad = cn("pl-6", group && "py-1");
  // A row with somewhere to go is one target: both cells lead to the ledger
  // and light up together. The figure's link is for the pointer only, so the
  // keyboard stops on the row once.
  const rowLink = cn(CELL_LINK, "group-hover/row:bg-sap-drill-down-link-soft");
  return (
    <tr
      className={cn(
        "first:border-t-0",
        group ? "" : "border-t border-line-inner",
        href && "group/row",
      )}
    >
      <td
        className={cn(
          "w-full max-w-0 truncate",
          !href && labelPad,
          // A total's label is softer than its figure; a group's is not.
          strong || group ? ink : "text-ink-soft",
        )}
      >
        {href ? (
          <Link to={href} className={cn(rowLink, "truncate", labelPad)}>
            {label}
          </Link>
        ) : (
          label
        )}
      </td>
      <Td className={cn(ink, href ? "p-0" : valuePad)}>
        {href ? (
          <Link
            to={href}
            tabIndex={-1}
            aria-hidden="true"
            className={cn(rowLink, "-mr-2 pr-2", valuePad)}
          >
            {value}
          </Link>
        ) : (
          value
        )}
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

/**
 * A link that fills its table cell, so the whole cell is the target and its
 * fill shows at once under the pointer or keyboard focus. The cell drops its
 * padding and the link carries it.
 */
const CELL_LINK =
  "block text-inherit no-underline outline-none hover:bg-sap-drill-down-link-soft focus-visible:bg-sap-drill-down-link-soft";

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

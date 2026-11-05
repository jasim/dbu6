import { type ReactNode, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, CreditCard, Landmark } from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@sapporta/frontend/shell";
import type {
  HomeSummary,
  OverviewWorthGroup,
  PostedOverview,
} from "../../shared/index";
import { apiErrorMessage, overviewApi } from "../api";
import { LoadError } from "../components/load-error";
import { Screen } from "../components/screen";
import { buttonVariants } from "../components/ui/button";
import {
  formatDate,
  formatMonth,
  formatWholeMoney,
  joinNames,
  plural,
} from "../format";
import { typingIn } from "../keys";
import { formatWholeAmount } from "../report-kit";
import {
  FRESH_QUERY,
  homeSummaryQuery,
  openingBalancesQuery,
} from "../queries";
import { BALANCES_SETTINGS_ROUTE } from "../views/settings/routes";
import { CELL_LINK, ROW_PAD, SheetHead, Td, Th } from "../sheet";
import { figures, signedAmount } from "../reports/income-expenses/figures";
import { shadeColor, shades } from "../reports/income-expenses/shade";
import {
  accountLedgerHref,
  accountsByMonthHref,
  balanceSheetHref,
  incomeExpensesHref,
} from "../reports/links";
import { today } from "../reports/shared";
import { UPDATE_ROUTE } from "../update/routes";
import { NextStep, UpdateHeader } from "../update/Update";
import {
  FIRST_RUN_GREETING,
  updateState,
  waitingInUpdate,
} from "../update/state";
import {
  categoryBars,
  categoryRows,
  type CategoryRow,
  figureSeries,
  type FigureSeries,
  figureSparkline,
  monthDates,
  monthForKey,
  monthSteps,
  otherWorthChange,
  type SparkLine,
  sparkline,
  statusLine,
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
        <h1 className="text-title text-foreground sm:text-display">Overview</h1>
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
        <div className="mt-5">
          <StatusLine summary={summary} />
          {/* The month sits on the strip it sums up, so its figures read as
              that month's. */}
          <MonthPicker overview={overview} onPick={setMonth} />
          <MonthFigures overview={overview} />
          {/* Where the month's money went on the left, where it stands on the
              right. Two columns only once both tables fit, and neither narrower
              than its table, so neither runs into the gap. */}
          <div className="grid items-start gap-x-10 xl:grid-cols-[repeat(2,minmax(min-content,1fr))]">
            <div className="min-w-0">
              <Categories overview={overview} />
            </div>
            <div className="min-w-0">
              <NetWorth overview={overview} />
              <Accounts overview={overview} />
            </div>
          </div>
        </div>
      ) : (
        <div aria-hidden="true" className="mt-5">
          <div className="h-[64px] rounded-lg bg-secondary" />
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
  const view = updateState(summary);
  return (
    <Screen
      width="narrow"
      header={<UpdateHeader greeting={FIRST_RUN_GREETING} firstRun />}
    >
      <NextStep view={view} />
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
    <div className="-ml-2 mb-2 flex items-center gap-1">
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

/** What waits in Update, in a tinted line. Hidden when nothing does. */
function StatusLine({ summary }: { summary: HomeSummary }) {
  const line = statusLine(summary, waitingInUpdate(summary));
  if (line === null) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-control bg-attention-bg py-1.5 pl-3 pr-1.5 text-row font-semibold text-attention-ink">
      <span>{line.text}</span>
      <Link
        to={UPDATE_ROUTE}
        className={cn(buttonVariants({ size: "sm" }), "no-underline")}
      >
        {line.action}
      </Link>
    </div>
  );
}

/**
 * The month's income, spending and savings in one tinted strip, each beside
 * the month and the months its average covers, so a month off its usual
 * shows at a glance. Saved % has no line: it would draw Saved's again.
 */
function MonthFigures({ overview }: { overview: PostedOverview }) {
  const current = figures(overview.figures);
  const series = figureSeries(overview);
  const income = current.income.direction === "in";
  const cells: {
    label: string;
    figure: string;
    series?: FigureSeries;
    ink?: string;
  }[] = [
    {
      label: "Income",
      figure: current.income.figure,
      series: series.income,
      ink: income ? "var(--money-in)" : undefined,
    },
    { label: "Spent", figure: current.spending.figure, series: series.spent },
    { label: "Saved", figure: savedFigure(current), series: series.saved },
    { label: "Saved %", figure: current.remaining.share ?? "—" },
  ];
  return (
    <div className="grid grid-cols-2 gap-y-2.5 rounded-lg bg-secondary py-2.5 sm:grid-cols-4">
      {cells.map((cell, index) => (
        <div
          key={cell.label}
          className={cn(
            "min-w-0 px-4",
            index > 0 && "border-l border-sap-border",
            index === 2 && "max-sm:border-l-0",
          )}
        >
          <div className="text-meta text-ink-meta">{cell.label}</div>
          <div className="mt-0.5 flex items-center justify-between gap-2.5">
            <span
              className="tnum whitespace-nowrap font-mono text-[19px] font-medium text-foreground"
              style={cell.ink ? { color: cell.ink } : undefined}
            >
              {cell.figure}
            </span>
            {cell.series && (
              <Sparkline
                line={figureSparkline(cell.series)}
                size={FIGURE_SPARK}
                dot={cell.ink ?? "var(--foreground)"}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Saved, or by how much spending went over income. */
function savedFigure(shown: ReturnType<typeof figures>): string {
  return shown.remaining.tone === "saved"
    ? shown.remaining.figure
    : `${shown.remaining.figure} over`;
}

const SHEET = "mt-10 w-full border-collapse text-row";

/**
 * The month's largest spending categories, each beside the month and the
 * months its average covers, then the rest and the total, so the table adds
 * up to Spent.
 */
function Categories({ overview }: { overview: PostedOverview }) {
  const dates = monthDates(overview.month);
  // A category's name opens its month-by-month chart over the months shown
  // here; its amount opens its entries for the month.
  const trend = {
    first_date: monthDates(overview.months[0].month).first_date,
    last_date: dates.last_date,
  };
  const { average } = overview.figures;
  const rows = categoryRows(overview);
  const bars = categoryBars(rows);
  // The bars' room: as wide as the longest of them this month, so the names
  // sit close to their bars.
  const room = Math.max(MIN_BAR, ...bars.map((bar) => (bar ?? 0) * FULL_BAR));
  // Each category's bar is shaded by its amount, as Income and Expenses
  // shades it; Other, being a mix, stays at the lightest.
  const tones = shades(
    rows.map((row) => (row.kind === "category" ? row.amount : 0)),
  );
  return (
    <table className={SHEET}>
      <SheetHead
        title="Spending by category"
        open={[
          {
            to: incomeExpensesHref(dates.first_date, dates.last_date),
            name: "Income & expenses",
          },
          {
            to: accountsByMonthHref(trend.first_date, trend.last_date, {
              group: "expense",
            }),
            name: "Accounts by Month",
            label: "By month",
          },
        ]}
      >
        <Th>{formatMonth(overview.month)}</Th>
        {average && (
          <Th className="hidden text-left sm:table-cell">
            Last{" "}
            {plural(
              overview.months.filter((m) => m.amounts !== null).length,
              "month",
            )}
          </Th>
        )}
      </SheetHead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={3} className="pt-2 text-ink-meta">
              No spending in {formatMonth(overview.month, "long")}.
            </td>
          </tr>
        )}
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
          const name = (
            <CategoryName
              name={row.name}
              bar={bar}
              room={room}
              tone={tones[index] ?? 0}
            />
          );
          return (
            <tr
              key={row.account_id ?? row.kind}
              className={cn(
                total
                  ? "border-t border-sap-border font-semibold"
                  : "hover:bg-sap-row-hover",
              )}
            >
              <td
                className={cn(
                  "max-w-0",
                  row.account_id === null && cn(ROW_PAD, "pr-3"),
                  row.kind === "other" ? "text-ink-soft" : "text-foreground",
                )}
              >
                {row.account_id === null ? (
                  name
                ) : (
                  <Link
                    to={incomeExpensesHref(trend.first_date, trend.last_date, {
                      accountId: row.account_id,
                      month: overview.month,
                    })}
                    className={cn(CELL_LINK, ROW_PAD, "-ml-2 pl-2 pr-3")}
                  >
                    {name}
                  </Link>
                )}
              </td>
              <Td className={cn("text-foreground", ledger !== null && "p-0")}>
                {ledger === null ? (
                  spent(row.amount)
                ) : (
                  <Link
                    to={ledger}
                    className={cn(CELL_LINK, ROW_PAD, "-mr-2 pl-5 pr-2")}
                  >
                    {spent(row.amount)}
                  </Link>
                )}
              </Td>
              {average && (
                <td className={cn(ROW_PAD, "hidden pl-5 sm:table-cell")}>
                  {!total && row.average !== null && (
                    <>
                      <span className="sr-only">
                        Average {spent(row.average)}
                      </span>
                      <Sparkline
                        line={sparkline(row)}
                        size={CATEGORY_SPARK}
                        dot="var(--spend-most)"
                      />
                    </>
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A bar's length in pixels for the whole month's spending, and at least. */
const FULL_BAR = 80;
const MIN_BAR = 3;

/**
 * A category's name after a short bar as long as its share of the month's
 * spending, so what each category took reads down the column beside its
 * name. The bar has no track: an empty one would outweigh a small share.
 * Total has an empty space in its place, so its name lines up with theirs.
 */
function CategoryName({
  name,
  bar,
  room,
  tone,
}: {
  name: string;
  bar: ReturnType<typeof categoryBars>[number];
  // The width in pixels the bars share, so the names line up.
  room: number;
  // Its shade, from 0 for the least to 1 for the most.
  tone: number;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="relative h-1.5 shrink-0"
        style={{ width: room }}
      >
        {bar !== null && bar > 0 && (
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              // A sliver stays visible; nothing at all draws nothing.
              width: Math.max(MIN_BAR, bar * FULL_BAR),
              background: shadeColor("spending", tone),
            }}
          />
        )}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Sparklines' sizes in pixels, and room at their edges for the dot. */
const CATEGORY_SPARK = { width: 112, height: 20, inset: 3 };
const FIGURE_SPARK = { width: 72, height: 18, inset: 3 };

/**
 * Months as a line, oldest at the left, with a dashed line at the average
 * and a dot on the month shown, so a month off its usual stands out.
 */
function Sparkline({
  line,
  size,
  dot,
}: {
  line: SparkLine | null;
  size: typeof CATEGORY_SPARK;
  dot: string;
}) {
  if (line === null) return null;
  const { width, height, inset } = size;
  const x = (fraction: number) => inset + fraction * (width - 2 * inset);
  const y = (fraction: number) =>
    height - inset - fraction * (height - 2 * inset);
  const last = line.points[line.points.length - 1];
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      className="block shrink-0 overflow-visible"
    >
      <line
        x1={x(0)}
        x2={x(1)}
        y1={y(line.average)}
        y2={y(line.average)}
        stroke="var(--ink-meta)"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      <polyline
        points={line.points
          .map((point) => `${x(point.x)},${y(point.y)}`)
          .join(" ")}
        fill="none"
        stroke="var(--ink-soft)"
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
      <circle cx={x(last.x)} cy={y(last.y)} r={2.5} fill={dot} />
    </svg>
  );
}

/** A spending amount, signed, in whole units. */
function spent(amount: number): string {
  return signedAmount("spending", amount);
}

/**
 * What is owned, less what is owed, at the month's end, each with where it
 * sits. Saved is the month's change in net worth, so the change shows only
 * for what moved it besides income and spending.
 */
function NetWorth({ overview }: { overview: PostedOverview }) {
  const { net_worth: worth } = overview;
  // Which accounts have no starting balance: the opening-balances check,
  // read as it is today.
  const unanswered = useQuery(openingBalancesQuery).data?.unanswered ?? [];
  const other = otherWorthChange(overview);
  const asOf = monthDates(overview.month).last_date;
  const ledger = (group: OverviewWorthGroup) =>
    group.account_id === null
      ? null
      : accountLedgerHref(group.account_id, { to_date: asOf });
  return (
    <table className={SHEET}>
      <SheetHead
        title="Net worth"
        open={{ to: balanceSheetHref(asOf), name: "Balance sheet" }}
      >
        <Th>{formatDate(asOf)}</Th>
      </SheetHead>
      <tbody>
        <WorthRow label="Assets" value={formatWholeMoney(worth.assets)} />
        {worth.asset_groups.map((group) => (
          <WorthRow
            key={group.account_id ?? "other"}
            label={group.name}
            value={formatWholeMoney(group.amount)}
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
          label={unanswered.length > 0 ? "Net worth (incomplete)" : "Net worth"}
          value={formatWholeMoney(worth.net)}
          strong
        />
        {other !== 0 && (
          <WorthRow
            label={`Opening balances and equity in ${formatMonth(overview.month)}`}
            value={signedAmount("income", other)}
            soft
          />
        )}
      </tbody>
      {unanswered.length > 0 && (
        <tbody>
          <tr>
            <td colSpan={2} className={cn(ROW_PAD, "text-body text-ink-soft")}>
              No starting balance:{" "}
              {joinNames(unanswered.map((one) => one.name))}.{" "}
              <Link
                to={BALANCES_SETTINGS_ROUTE}
                className="text-primary underline-offset-4 hover:underline"
              >
                Opening balances
              </Link>
            </td>
          </tr>
        </tbody>
      )}
    </table>
  );
}

/** An amount owed, taken away: "−2,19,305". */
function owed(amount: number): string {
  return formatWholeAmount(amount, amount > 0 ? "out" : "in");
}

function WorthRow({
  label,
  value,
  href = null,
  group = false,
  strong = false,
  soft = false,
}: {
  label: string;
  value: string;
  // Where a group's row leads: its ledger up to the month's end.
  href?: string | null;
  // A group under Assets or Liabilities: indented, and lighter.
  group?: boolean;
  // The total: bold, under a rule.
  strong?: boolean;
  // A note under the total: its figure as light as its label.
  soft?: boolean;
}) {
  const pad = group ? "py-0.5" : ROW_PAD;
  const labelPad = cn(pad, "pr-3", group && "pl-4");
  const valuePad = cn(pad, "pl-5");
  // A row with somewhere to go is one target: both cells lead to the ledger
  // and light up together. The figure's link is for the pointer only, so the
  // keyboard stops on the row once.
  const rowLink = cn(CELL_LINK, "group-hover/row:bg-sap-drill-down-link-soft");
  return (
    <tr
      className={cn(
        strong && "border-t border-sap-border font-semibold",
        group ? "text-ink-soft hover:bg-sap-row-hover" : "text-foreground",
        href && "group/row",
      )}
    >
      <td
        className={cn(
          "w-full max-w-0 truncate",
          !href && labelPad,
          // A heading's label is softer than its figure; a total's is not.
          !strong && !group && "text-ink-soft",
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
      <Td className={cn(soft && "text-ink-soft", href ? "p-0" : valuePad)}>
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
  return (
    <table className={SHEET}>
      <SheetHead title="Accounts">
        <Th>Balance</Th>
        <Th className="hidden sm:table-cell">Books until</Th>
      </SheetHead>
      <tbody>
        {overview.accounts.map((account) => {
          const Icon = account.kind === "card" ? CreditCard : Landmark;
          const ledger = accountLedgerHref(account.account_id);
          const balance =
            account.kind === "card"
              ? `${formatWholeMoney(account.balance)} owed`
              : formatWholeMoney(account.balance);
          const name = (
            <span className="flex min-w-0 items-center gap-2">
              <Icon
                className="size-4 shrink-0 text-ink-meta"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block truncate font-semibold text-foreground">
                  {account.name}
                </span>
                {/* On a phone the date goes under the name. */}
                <span className="block text-meta text-ink-meta sm:hidden">
                  Books until {booksUntil(account.books_until)}
                </span>
              </span>
            </span>
          );
          // The whole row leads to the ledger: every cell is a link. The
          // figures' links are for the pointer only, so the keyboard stops
          // on the row once.
          const rowLink = "block text-inherit no-underline outline-none";
          return (
            <tr
              key={account.account_id}
              className={cn(
                "hover:bg-sap-row-hover",
                ledger && "group/row has-[a:focus-visible]:bg-sap-row-hover",
              )}
            >
              <td className={cn("max-w-0", !ledger && cn(ROW_PAD, "pr-3"))}>
                {ledger ? (
                  <Link to={ledger} className={cn(rowLink, ROW_PAD, "pr-3")}>
                    {name}
                  </Link>
                ) : (
                  name
                )}
              </td>
              <Td className={cn("text-foreground", ledger && "p-0")}>
                {ledger ? (
                  <Link
                    to={ledger}
                    tabIndex={-1}
                    aria-hidden="true"
                    className={cn(rowLink, ROW_PAD, "pl-5")}
                  >
                    {balance}
                  </Link>
                ) : (
                  balance
                )}
              </Td>
              <Td
                className={cn(
                  "hidden text-ink-soft sm:table-cell",
                  ledger && "p-0",
                )}
              >
                {ledger ? (
                  <Link
                    to={ledger}
                    tabIndex={-1}
                    aria-hidden="true"
                    className={cn(rowLink, ROW_PAD, "pl-5")}
                  >
                    {booksUntil(account.books_until)}
                  </Link>
                ) : (
                  booksUntil(account.books_until)
                )}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function booksUntil(date: string | null): string {
  return date === null ? "—" : formatDate(date);
}

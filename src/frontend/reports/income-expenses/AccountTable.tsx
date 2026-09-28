import {
  ChevronRight,
  cn,
  type KeyboardEvent,
  type ReactNode,
} from "../../report-kit";
import type {
  IncomeExpenses,
  IncomeExpensesAccount,
} from "../../../shared/index";
import { barSeries, type ChartBar } from "./chart";
import { shadeColor } from "./shade";
import {
  amountDirection,
  formatShare,
  shareOf,
  signedAmount,
  type Section,
} from "./figures";
import { ownMonths, sameFocus, sectionRows, type Focus } from "./selection";

/*
 * Spending and Income as one table of accounts (PLAN.md §11 P4): each
 * section's accounts as their tree, one level open at a time, with what each
 * took in view (the period, or the chart's selected bar), its share of the
 * section as a bar, and its months as a small chart. Names, amounts and bars
 * share columns across both sections, so a name sits beside its amount and
 * the eye runs down each column.
 *
 * Every row does one thing on click: it brings its account into focus, and
 * the chart and the entries follow. The chevron alone opens a row.
 */

const TITLES: Record<Section, string> = {
  spending: "Spending",
  income: "Income",
};

type RowContext = {
  section: Section;
  sectionTotal: number;
  /** The largest of the section's first rows in view, for the bars' shade. */
  largest: number;
  /** The row's amount in view: its total, or its months in the bar. */
  amountOf: (months: readonly number[], total: number) => number;
  bars: readonly ChartBar[];
  selectedIndex: number | null;
  focus: Focus;
  onFocus: (focus: Focus) => void;
  open: ReadonlySet<number>;
  onToggle: (accountId: number) => void;
};

export function AccountTable({
  report,
  bars,
  selectedBar,
  focus,
  onFocus,
  open,
  onToggle,
}: {
  report: IncomeExpenses;
  bars: readonly ChartBar[];
  selectedBar: ChartBar | null;
  focus: Focus;
  onFocus: (focus: Focus) => void;
  open: ReadonlySet<number>;
  onToggle: (accountId: number) => void;
}) {
  const amountOf = (months: readonly number[], total: number) =>
    selectedBar === null
      ? total
      : selectedBar.months.reduce(
          (sum, index) => sum + (months[index] ?? 0),
          0,
        );
  const selectedIndex =
    selectedBar === null
      ? null
      : bars.findIndex((bar) => bar.key === selectedBar.key);
  const context = {
    amountOf,
    bars,
    selectedIndex,
    focus,
    onFocus,
    open,
    onToggle,
  };

  return (
    <section
      role="table"
      aria-label="Spending and income by account"
      className="grid grid-cols-[minmax(0,1fr)_auto] rounded-card sm:grid-cols-[minmax(8rem,max-content)_auto_minmax(48px,1fr)_auto_auto] border border-sap-border bg-card pb-2 shadow-card"
    >
      {(["spending", "income"] as const).map((section) => (
        <SectionRows
          key={section}
          section={section}
          report={report}
          selectedBar={selectedBar}
          context={context}
        />
      ))}
    </section>
  );
}

function SectionRows({
  section,
  report,
  selectedBar,
  context,
}: {
  section: Section;
  report: IncomeExpenses;
  selectedBar: ChartBar | null;
  context: Omit<RowContext, "section" | "sectionTotal" | "largest">;
}) {
  const data = report[section];
  const sectionTotal = selectedBar === null ? data.total : selectedBar[section];
  const months = report.months.map((month) => month[section]);
  const { rows, ownOf } = sectionRows(data.accounts);
  const largest = Math.max(
    0,
    ...rows.map((account) => context.amountOf(account.months, account.total)),
  );
  const rowContext: RowContext = {
    ...context,
    section,
    sectionTotal,
    largest,
  };
  const focus: Focus = { kind: "section", section };

  return (
    <div role="rowgroup" className="col-span-full grid grid-cols-subgrid">
      <Row
        context={rowContext}
        focus={focus}
        className={cn("pt-3 pb-2", section === "income" && "mt-4")}
        name={
          <h2 className="text-heading text-foreground">{TITLES[section]}</h2>
        }
        amount={
          <span
            className={cn(
              "tnum font-mono text-[17px] font-semibold",
              amountDirection(section, sectionTotal) === "in"
                ? "text-money-in"
                : "text-foreground",
            )}
          >
            {signedAmount(section, sectionTotal)}
          </span>
        }
        months={months}
        depth={0}
        header
      />
      {data.accounts.length === 0 ? (
        <p className="col-span-full border-t border-line-inner px-4 py-3 text-meta text-ink-meta">
          No {section} in these months
        </p>
      ) : (
        <>
          {rows.map((account) => (
            <AccountRow
              key={account.account_id}
              account={account}
              depth={0}
              context={rowContext}
            />
          ))}
          {ownOf && <OwnRow parent={ownOf} depth={0} context={rowContext} />}
        </>
      )}
    </div>
  );
}

function AccountRow({
  account,
  depth,
  context,
}: {
  account: IncomeExpensesAccount;
  depth: number;
  context: RowContext;
}) {
  const hasChildren = account.children.length > 0;
  const isOpen = hasChildren && context.open.has(account.account_id);
  return (
    <>
      <Row
        context={context}
        focus={{
          kind: "account",
          section: context.section,
          accountId: account.account_id,
        }}
        name={
          <span
            title={account.name}
            className={cn(
              "block max-w-[22rem] truncate text-row text-foreground",
              depth === 0 ? "font-medium" : "font-normal",
            )}
          >
            {account.name}
          </span>
        }
        total={context.amountOf(account.months, account.total)}
        months={account.months}
        depth={depth}
        expander={
          hasChildren
            ? {
                open: isOpen,
                onToggle: () => context.onToggle(account.account_id),
                name: account.name,
              }
            : null
        }
      />
      {isOpen && (
        <>
          {account.children.map((child) => (
            <AccountRow
              key={child.account_id}
              account={child}
              depth={depth + 1}
              context={context}
            />
          ))}
          {account.own !== 0 && (
            <OwnRow parent={account} depth={depth + 1} context={context} />
          )}
        </>
      )}
    </>
  );
}

/**
 * A parent's own entries, so its children add up to its row. Its months are
 * the parent's less its children's.
 */
function OwnRow({
  parent,
  depth,
  context,
}: {
  parent: IncomeExpensesAccount;
  depth: number;
  context: RowContext;
}) {
  const months = ownMonths(parent);
  const name = `${parent.name}, not in a sub-account`;
  return (
    <Row
      context={context}
      focus={{
        kind: "own",
        section: context.section,
        accountId: parent.account_id,
      }}
      name={
        <span
          title={name}
          className="block max-w-[22rem] truncate text-row italic text-ink-soft"
        >
          {name}
        </span>
      }
      total={context.amountOf(months, parent.own)}
      months={months}
      depth={depth}
    />
  );
}

/**
 * One line of the table, on the table's columns: name, amount, share bar,
 * share, months. Clicking anywhere on it but the chevron focuses it.
 */
function Row({
  context,
  focus,
  name,
  amount,
  total,
  months,
  depth,
  expander = null,
  header = false,
  className,
}: {
  context: RowContext;
  focus: Focus;
  name: ReactNode;
  /** The amount cell, when it isn't `total` as a row shows it. */
  amount?: ReactNode;
  total?: number;
  months: readonly number[];
  depth: number;
  expander?: { open: boolean; onToggle: () => void; name: string } | null;
  header?: boolean;
  className?: string;
}) {
  const { section, sectionTotal } = context;
  const selected = sameFocus(focus, context.focus);
  const share =
    header || total === undefined ? null : shareOf(total, sectionTotal);
  const select = () => context.onFocus(focus);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    } else if (expander && event.key === "ArrowRight" && !expander.open) {
      expander.onToggle();
    } else if (expander && event.key === "ArrowLeft" && expander.open) {
      expander.onToggle();
    }
  };

  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={selected}
      aria-expanded={expander ? expander.open : undefined}
      onClick={select}
      onKeyDown={onKeyDown}
      className={cn(
        "col-span-full grid cursor-pointer grid-cols-subgrid items-center gap-x-4 pr-4 outline-none transition-colors duration-100",
        "focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40",
        !header && "min-h-[38px] border-t border-line-inner",
        selected
          ? "bg-primary/[0.07] shadow-[inset_3px_0_0_var(--primary)]"
          : "hover:bg-muted",
        className,
      )}
    >
      <div
        role="rowheader"
        className="flex min-w-0 items-center gap-1"
        style={{ paddingLeft: `${8 + depth * 20}px` }}
      >
        {expander ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${expander.open ? "Close" : "Open"} ${expander.name}`}
            onClick={(event) => {
              event.stopPropagation();
              expander.onToggle();
            }}
            className="grid size-7 shrink-0 place-items-center rounded-control text-ink-meta hover:bg-sap-border/60 hover:text-foreground"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-4 transition-transform duration-150",
                expander.open && "rotate-90",
              )}
            />
          </button>
        ) : (
          <span aria-hidden="true" className="w-7 shrink-0" />
        )}
        {name}
      </div>
      <div role="cell" className="justify-self-end">
        {amount ??
          (total !== undefined && (
            <span
              className={cn(
                "tnum font-mono text-[14.5px]",
                total === 0
                  ? "text-ink-meta"
                  : amountDirection(section, total) === "in"
                    ? "text-money-in"
                    : "text-foreground",
              )}
            >
              {total === 0 ? "–" : signedAmount(section, total)}
            </span>
          ))}
      </div>
      {/* On a phone, name and amount alone. */}
      <div role="cell" aria-hidden="true" className="hidden min-w-0 sm:block">
        {share !== null && (
          <span
            className="block h-2 rounded-[2px]"
            style={{
              width: `max(2px, ${Math.min(share, 1) * 100}%)`,
              // The biggest account deepest.
              background: shadeColor(
                section,
                context.largest > 0
                  ? Math.min(1, (total ?? 0) / context.largest)
                  : 0,
              ),
            }}
          />
        )}
      </div>
      <div
        role="cell"
        className="tnum hidden w-10 sm:block text-right font-mono text-meta text-ink-meta"
      >
        {share !== null ? formatShare(share) : null}
      </div>
      <div role="cell" aria-hidden="true" className="hidden sm:block">
        <Sparkline
          values={barSeries(context.bars, months)}
          selectedIndex={context.selectedIndex}
          section={section}
        />
      </div>
    </div>
  );
}

/**
 * An account's bars in the chart's buckets, small: its shape over the
 * period, on its own scale, with the selected bar picked out.
 */
function Sparkline({
  values,
  selectedIndex,
  section,
}: {
  values: readonly number[];
  selectedIndex: number | null;
  section: Section;
}) {
  if (values.length < 2) return <span className="block w-[84px]" />;
  const top = Math.max(0, ...values);
  return (
    <span className="flex h-5 w-[84px] items-end gap-px">
      {values.map((value, index) => (
        <span
          key={index}
          className={cn(
            "min-w-0 flex-1 rounded-t-[1px]",
            section === "income" ? "bg-money-in" : "bg-foreground",
            selectedIndex === null
              ? "opacity-40"
              : index === selectedIndex
                ? "opacity-100"
                : "opacity-20",
          )}
          style={{
            height:
              top > 0 && value > 0 ? `max(1px, ${(value / top) * 100}%)` : 0,
          }}
        />
      ))}
    </span>
  );
}

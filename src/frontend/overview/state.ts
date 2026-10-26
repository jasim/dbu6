import type { PostedOverview } from "../../shared/index";
import { agree, formatMonth, plural } from "../format";
import { Temporal } from "../report-kit";

/*
 * What Overview says, as pure functions of its two requests: the overview
 * says whether there is anything to show and carries the month's figures;
 * the home summary says what waits in Update. Months are `YYYY-MM`,
 * dates `YYYY-MM-DD`.
 */

/** The month's first and last days. */
export function monthDates(month: string): {
  first_date: string;
  last_date: string;
} {
  const yearMonth = Temporal.PlainYearMonth.from(month);
  return {
    first_date: yearMonth.toPlainDate({ day: 1 }).toString(),
    last_date: yearMonth
      .toPlainDate({ day: yearMonth.daysInMonth })
      .toString(),
  };
}

/**
 * The months ◂ and ▸ step to: none before the books' first month, none
 * after this month.
 */
export function monthSteps(
  month: string,
  firstMonth: string | null,
  today: string,
): { previous: string | null; next: string | null } {
  const yearMonth = Temporal.PlainYearMonth.from(month);
  const previous = yearMonth.subtract({ months: 1 }).toString();
  const next = yearMonth.add({ months: 1 }).toString();
  return {
    previous: firstMonth !== null && previous >= firstMonth ? previous : null,
    next: next <= today.slice(0, 7) ? next : null,
  };
}

/** The month a key steps to: `[` the one before, `]` the one after. */
export function monthForKey(
  key: string,
  steps: { previous: string | null; next: string | null },
): string | null {
  if (key === "[") return steps.previous;
  if (key === "]") return steps.next;
  return null;
}

/** The averages' column label: "12-month average", or what it covers so far. */
export function averageLabel(months: number): string {
  if (months === 12) return "12-month average";
  return `Average of ${plural(months, "month")}`;
}

/**
 * What moved net worth in the month besides income and spending: opening
 * balances and other equity entries. Saved is the rest of the change, so
 * this is zero in an ordinary month.
 */
export function otherWorthChange(overview: PostedOverview): number {
  const { net_worth: worth, figures } = overview;
  return cents(
    worth.net - worth.previous_net - (figures.income - figures.spending),
  );
}

/** A row of Spending by category: a category, the rest, or the total. */
export type CategoryRow = {
  kind: "category" | "other" | "total";
  // The category's account; null for Other and Total.
  account_id: number | null;
  name: string;
  amount: number;
  // Null before the books have a month to average.
  average: number | null;
};

/**
 * The categories, then Other for the spending they leave out, then Total,
 * so the table adds up to Spent. The categories divide the spending between
 * them, so Other is exact. It carries no count: a category with nothing
 * this month can still be in its average. It shows only when it holds
 * anything.
 */
export function categoryRows(overview: PostedOverview): CategoryRow[] {
  const { categories, figures } = overview;
  if (categories.length === 0) return [];
  const averaged = figures.average !== null;
  const rest = (total: number, parts: readonly number[]) =>
    cents(parts.reduce((left, part) => left - part, total));
  const other = {
    amount: rest(
      figures.spending,
      categories.map((category) => category.amount),
    ),
    average: figures.average
      ? rest(
          figures.average.spending,
          categories.map((category) => category.average ?? 0),
        )
      : null,
  };
  return [
    ...categories.map(
      (category): CategoryRow => ({
        kind: "category",
        ...category,
        average: averaged ? category.average : null,
      }),
    ),
    ...(other.amount !== 0 || (other.average ?? 0) !== 0
      ? [{ kind: "other" as const, account_id: null, name: "Other", ...other }]
      : []),
    {
      kind: "total",
      account_id: null,
      name: "Total",
      amount: figures.spending,
      average: figures.average?.spending ?? null,
    },
  ];
}

/**
 * Each row's bar under its name: how far this month's amount and the
 * average reach, as fractions of the largest of either among the rows, so
 * every bar and tick shares one scale. Total has none, and neither has a
 * refund (a negative amount) or a missing average.
 */
export function categoryBars(
  rows: readonly CategoryRow[],
): ({ amount: number; average: number | null } | null)[] {
  const parts = rows.filter((row) => row.kind !== "total");
  const largest = Math.max(
    0,
    ...parts.flatMap((row) => [row.amount, row.average ?? 0]),
  );
  const reach = (value: number) =>
    largest > 0 && value > 0 ? value / largest : 0;
  return rows.map((row) =>
    row.kind === "total" || largest === 0
      ? null
      : {
          amount: reach(row.amount),
          average:
            row.average === null || row.average <= 0
              ? null
              : reach(row.average),
        },
  );
}

function cents(amount: number): number {
  const rounded = Math.round(amount * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** "2 accounts need attention", or nothing when none does. */
export function waitingLabel(count: number): string | null {
  if (count === 0) return null;
  return `${plural(count, "account")} ${agree(count, "needs", "need")} attention`;
}

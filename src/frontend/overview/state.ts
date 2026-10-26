import type { PostedOverview } from "../../shared/index";
import { MINUS } from "../components/amount";
import { agree, formatMonth, plural } from "../format";
import { formatAmount, formatMoney, Temporal } from "../report-kit";

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

/**
 * The accounts whose books stop at "Complete until", which hold the default
 * month back: two named, and how many more. None when every account with a
 * balance check stops there, since then nothing is behind the others.
 */
export function holdingAccounts(overview: PostedOverview): {
  named: PostedOverview["accounts"];
  more: number;
} | null {
  const { complete_until: until, accounts } = overview;
  if (until === null) return null;
  const checked = accounts.filter((account) => account.books_until !== null);
  const holding = checked.filter((account) => account.books_until === until);
  if (holding.length === checked.length) return null;
  return { named: holding.slice(0, 2), more: Math.max(0, holding.length - 2) };
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

/** A month's income and spending, both positive, as the overview has them. */
export type MonthTotals = { income: number; spending: number };

/**
 * A figure less its average, both as the table shows them, so the column
 * reads as one minus the other: spending shows negative, so spending more
 * than usual makes a negative difference. Null without an average.
 */
export function difference(
  shown: number,
  average: number | null,
): string | null {
  if (average === null) return null;
  const value = cents(shown - average);
  if (value === 0) return formatMoney(0);
  return formatAmount(value, value > 0 ? "in" : "out");
}

/** Saved % less the average's, in percentage points: "+14 pts". */
export function savedShareDifference(
  month: MonthTotals,
  average: MonthTotals | null,
): string | null {
  if (average === null) return null;
  const current = savedShare(month);
  const usual = savedShare(average);
  if (current === null || usual === null) return "—";
  const points = current - usual;
  return `${points > 0 ? "+" : points < 0 ? MINUS : ""}${Math.abs(points)} pts`;
}

/** Saved % in whole points, as the figures show it; null without savings. */
function savedShare({ income, spending }: MonthTotals): number | null {
  const saved = income - spending;
  return income > 0 && saved >= 0 ? Math.round((saved / income) * 100) : null;
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

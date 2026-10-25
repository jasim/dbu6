import type { HomeSummary, PostedOverview } from "../../shared/index";
import { agree, formatMonth, plural } from "../format";
import { Temporal } from "../report-kit";
import { accountStatus, statementsHref } from "../update/state";

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

/** "Change since Mar 2026": net worth against the month before's. */
export function netWorthChange(overview: PostedOverview): {
  label: string;
  value: number;
} {
  return {
    label: `Change since ${formatMonth(
      Temporal.PlainYearMonth.from(overview.month)
        .subtract({ months: 1 })
        .toString(),
    )}`,
    value: overview.net_worth.net - overview.net_worth.previous_net,
  };
}

/**
 * What the status line points at in Update: how many accounts have
 * something waiting, the rule Update's rows follow. Zero when none.
 */
export function waitingInUpdate(summary: HomeSummary): number {
  const to = statementsHref(summary);
  return summary.accounts.filter(
    (account) => accountStatus(account, to) !== null,
  ).length;
}

/** "2 accounts need attention", or nothing when none does. */
export function waitingLabel(count: number): string | null {
  if (count === 0) return null;
  return `${plural(count, "account")} ${agree(count, "needs", "need")} attention`;
}

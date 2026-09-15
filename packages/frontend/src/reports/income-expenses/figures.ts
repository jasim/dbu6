import type { IncomeExpenses, IncomeExpensesAccount } from "dbu6-shared";
import { formatAmount, type Direction } from "../../components/amount";
import { formatMoney, plural } from "../../format";

/*
 * What the figures at the top of Where your money went say (PLAN.md §11 P4),
 * and the direction and share of any amount in its section. Income and
 * spending both arrive positive; a negative amount has run the other way
 * (refunds larger than the spending, say).
 */

export type Section = "income" | "spending";

/**
 * Income is money in and spending is money out, unless the amount runs the
 * other way.
 */
export function amountDirection(section: Section, value: number): Direction {
  const inward = section === "income";
  return value < 0 ? (inward ? "out" : "in") : inward ? "in" : "out";
}

/** An amount with its sign and the rupee sign: "+₹1,20,000.00". */
export function signedAmount(section: Section, value: number): string {
  return formatAmount(value, amountDirection(section, value), {
    symbol: true,
  });
}

export type Remaining =
  | { tone: "kept"; figure: string; line: string | null }
  | { tone: "overspent"; figure: string; line: string };

/** A section's figure: signed, and green when the money came in. */
export type SectionFigure = {
  figure: string;
  direction: Direction;
  line: string;
};

export type Figures = {
  income: SectionFigure;
  spending: SectionFigure;
  remaining: Remaining;
};

export function figures(report: IncomeExpenses): Figures {
  const income = report.income.total;
  const spending = report.spending.total;
  const remaining = income - spending;
  return {
    income: {
      figure: signedAmount("income", income),
      direction: amountDirection("income", income),
      line: `From ${plural(accountsWithAmounts(report.income.accounts), "account")}`,
    },
    spending: {
      figure: signedAmount("spending", spending),
      direction: amountDirection("spending", spending),
      line: `Across ${plural(accountsWithAmounts(report.spending.accounts), "account")}`,
    },
    remaining:
      remaining < 0
        ? {
            // Overspending isn't an error: ink on a neutral panel, never red.
            tone: "overspent",
            figure: formatAmount(remaining, "out", { symbol: true }),
            line: `${formatMoney(-remaining)} more spent than came in`,
          }
        : {
            tone: "kept",
            figure: formatMoney(remaining),
            line:
              income > 0
                ? `${Math.round((remaining / income) * 100)}% of income`
                : null,
          },
  };
}

/** Whether nothing in the books falls in the period. */
export function isEmptyPeriod(report: IncomeExpenses): boolean {
  return (
    report.income.accounts.length === 0 && report.spending.accounts.length === 0
  );
}

/** The accounts in a tree with an amount of their own. */
export function accountsWithAmounts(
  accounts: readonly IncomeExpensesAccount[],
): number {
  return accounts.reduce(
    (count, account) =>
      count +
      (account.own !== 0 ? 1 : 0) +
      accountsWithAmounts(account.children),
    0,
  );
}

/**
 * An amount's share of its section's total, as a fraction, or null when the
 * amount runs the other way (or the section has nothing to share).
 */
export function shareOf(value: number, sectionTotal: number): number | null {
  if (value <= 0 || sectionTotal <= 0) return null;
  return value / sectionTotal;
}

/** A share in whole percent: "7%", or "<1%" for a sliver. */
export function formatShare(share: number): string {
  const percent = Math.round(share * 100);
  return percent === 0 ? "<1%" : `${percent}%`;
}

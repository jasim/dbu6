import { type Direction, formatAmount, formatMoney } from "../../report-kit";
import type {
  IncomeExpenses,
  IncomeExpensesAccount,
} from "../../../shared/index";

/*
 * What the figures at the top of Income and Expenses say (PLAN.md §11 P4),
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

/** An amount with its sign: "+1,20,000.00". */
export function signedAmount(section: Section, value: number): string {
  return formatAmount(value, amountDirection(section, value));
}

/** What the income and spending left: kept, or overspent by. */
export type Remaining =
  | { tone: "kept"; figure: string; share: string | null }
  | { tone: "overspent"; figure: string; share: null };

/** A section's figure: signed, and green when the money came in. */
export type SectionFigure = {
  figure: string;
  direction: Direction;
};

export type Figures = {
  income: SectionFigure;
  spending: SectionFigure;
  remaining: Remaining;
};

/** The header's figures for income and spending over what is in view. */
export function figures(totals: { income: number; spending: number }): Figures {
  const { income, spending } = totals;
  const remaining = income - spending;
  return {
    income: {
      figure: signedAmount("income", income),
      direction: amountDirection("income", income),
    },
    spending: {
      figure: signedAmount("spending", spending),
      direction: amountDirection("spending", spending),
    },
    remaining:
      remaining < 0
        ? // Overspending isn't an error: ink, never red.
          { tone: "overspent", figure: formatMoney(-remaining), share: null }
        : {
            tone: "kept",
            figure: formatMoney(remaining),
            share:
              income > 0 ? `${Math.round((remaining / income) * 100)}%` : null,
          },
  };
}

/** Whether nothing in the books falls in the period. */
export function isEmptyPeriod(report: IncomeExpenses): boolean {
  return (
    report.income.accounts.length === 0 && report.spending.accounts.length === 0
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

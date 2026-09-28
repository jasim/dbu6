import { describe, expect, it } from "vitest";
import type {
  IncomeExpenses,
  IncomeExpensesAccount,
} from "../../../shared/index";
import { MINUS } from "../../components/amount";
import {
  amountDirection,
  figures,
  formatShare,
  isEmptyPeriod,
  shareOf,
  signedAmount,
} from "./figures";

function account(
  name: string,
  own: number,
  children: IncomeExpensesAccount[] = [],
): IncomeExpensesAccount {
  return {
    account_id: name.length,
    name,
    own,
    total: own + children.reduce((total, child) => total + child.total, 0),
    months: [],
    children,
  };
}

function report(
  income: IncomeExpensesAccount[],
  spending: IncomeExpensesAccount[],
): IncomeExpenses {
  const total = (accounts: IncomeExpensesAccount[]) =>
    accounts.reduce((sum, node) => sum + node.total, 0);
  return {
    income: { total: total(income), accounts: income },
    spending: { total: total(spending), accounts: spending },
    months: [],
    first_month: null,
  };
}

describe("figures", () => {
  it("sign income and spending and say what was kept", () => {
    expect(figures({ income: 100000, spending: 79000 })).toEqual({
      income: { figure: "+1,00,000.00", direction: "in" },
      spending: { figure: `${MINUS}79,000.00`, direction: "out" },
      remaining: { tone: "kept", figure: "21,000.00", share: "21%" },
    });
  });

  it("say how much more was spent, in ink, when spending is higher", () => {
    expect(figures({ income: 50000, spending: 62500 }).remaining).toEqual({
      tone: "overspent",
      figure: "12,500.00",
      share: null,
    });
  });

  it("leave the share out when there is no income", () => {
    expect(figures({ income: 0, spending: 0 }).remaining).toEqual({
      tone: "kept",
      figure: "0.00",
      share: null,
    });
    expect(figures({ income: 0, spending: 100 }).remaining.tone).toBe(
      "overspent",
    );
  });

  it("sign a section running the other way the other way", () => {
    expect(figures({ income: 0, spending: -500 }).spending).toEqual({
      figure: "+500.00",
      direction: "in",
    });
  });

  it("know an empty period", () => {
    expect(isEmptyPeriod(report([], []))).toBe(true);
    expect(isEmptyPeriod(report([], [account("rent", 100)]))).toBe(false);
  });
});

describe("directions and shares", () => {
  it("sign income in and spending out, unless they run the other way", () => {
    expect(amountDirection("income", 100)).toBe("in");
    expect(amountDirection("spending", 100)).toBe("out");
    expect(amountDirection("spending", -100)).toBe("in");
    expect(amountDirection("income", -100)).toBe("out");
    expect(signedAmount("spending", 84500)).toBe(`${MINUS}84,500.00`);
    expect(signedAmount("spending", -500)).toBe("+500.00");
  });

  it("share of the section, with none for amounts running the other way", () => {
    expect(shareOf(7000, 100000)).toBe(0.07);
    expect(shareOf(-500, 100000)).toBeNull();
    expect(shareOf(0, 100000)).toBeNull();
    expect(shareOf(500, 0)).toBeNull();
    expect(formatShare(0.07)).toBe("7%");
    expect(formatShare(0.004)).toBe("<1%");
    expect(formatShare(1)).toBe("100%");
  });
});

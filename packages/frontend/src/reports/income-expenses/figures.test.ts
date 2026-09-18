import { describe, expect, it } from "vitest";
import type { IncomeExpenses, IncomeExpensesAccount } from "dbu6-shared";
import { MINUS } from "../../components/amount";
import {
  accountsWithAmounts,
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
  it("count the accounts with amounts and what was kept", () => {
    const result = figures(
      report(
        [account("salary", 90000, [account("bonus", 10000)])],
        [
          account("expenses", 0, [
            account("food", 500, [account("groceries", 20500)]),
            account("rent", 58000),
          ]),
        ],
      ),
    );

    expect(result).toEqual({
      income: {
        figure: "+₹1,00,000.00",
        direction: "in",
        line: "From 2 accounts",
      },
      spending: {
        figure: `${MINUS}₹79,000.00`,
        direction: "out",
        line: "Across 3 accounts",
      },
      remaining: {
        tone: "kept",
        figure: "₹21,000.00",
        line: "21% of income",
      },
    });
  });

  it("say how much more was spent, in ink, when spending is higher", () => {
    expect(
      figures(report([account("salary", 50000)], [account("rent", 62500)]))
        .remaining,
    ).toEqual({
      tone: "overspent",
      figure: `${MINUS}₹12,500.00`,
      line: "₹12,500.00 more spent than came in",
    });
  });

  it("leave the share out when there is no income", () => {
    expect(figures(report([], [])).remaining).toEqual({
      tone: "kept",
      figure: "₹0.00",
      line: null,
    });
    expect(figures(report([], [account("rent", 100)])).remaining.tone).toBe(
      "overspent",
    );
    expect(figures(report([], [])).income.line).toBe("From 0 accounts");
    expect(figures(report([account("salary", 100)], [])).income.line).toBe(
      "From 1 account",
    );
  });

  it("sign a section running the other way the other way", () => {
    expect(figures(report([], [account("shopping", -500)])).spending).toEqual({
      figure: "+₹500.00",
      direction: "in",
      line: "Across 1 account",
    });
  });

  it("know an empty period", () => {
    expect(isEmptyPeriod(report([], []))).toBe(true);
    expect(isEmptyPeriod(report([], [account("rent", 100)]))).toBe(false);
  });

  it("don't count a parent without an amount of its own", () => {
    expect(
      accountsWithAmounts([account("expenses", 0, [account("rent", 100)])]),
    ).toBe(1);
  });
});

describe("directions and shares", () => {
  it("sign income in and spending out, unless they run the other way", () => {
    expect(amountDirection("income", 100)).toBe("in");
    expect(amountDirection("spending", 100)).toBe("out");
    expect(amountDirection("spending", -100)).toBe("in");
    expect(amountDirection("income", -100)).toBe("out");
    expect(signedAmount("spending", 84500)).toBe(`${MINUS}₹84,500.00`);
    expect(signedAmount("spending", -500)).toBe("+₹500.00");
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

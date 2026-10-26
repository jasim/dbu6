import { describe, expect, it } from "vitest";
import type {
  IncomeExpenses,
  IncomeExpensesAccount,
} from "../../../shared/index";
import { incomeExpensesFileName, incomeExpensesSheets } from "./export";

/** An account over August and September 2026, with its own months. */
function account(
  account_id: number,
  name: string,
  own: [number, number],
  children: IncomeExpensesAccount[] = [],
): IncomeExpensesAccount {
  const months = children.reduce(
    (sums, child) => sums.map((sum, index) => sum + child.months[index]),
    [...own],
  );
  return {
    account_id,
    name,
    own: own[0] + own[1],
    total: months[0] + months[1],
    months,
    children,
  };
}

const report: IncomeExpenses = {
  income: { total: 50000, accounts: [account(10, "Salary", [25000, 25000])] },
  spending: {
    total: 23500,
    accounts: [
      account(
        1,
        "Expenses",
        [0, 0],
        [
          account(4, "Rent", [10000, 10000]),
          account(2, "Food", [0, 500], [account(3, "Groceries", [1500, 1500])]),
        ],
      ),
    ],
  },
  months: [
    { month: "2026-08", income: 25000, spending: 11500 },
    { month: "2026-09", income: 25000, spending: 12000 },
  ],
};

describe("incomeExpensesSheets", () => {
  it("lists expenses then incomes as flat accounts by their own amounts", () => {
    const [expenses, incomes] = incomeExpensesSheets(report);
    expect(expenses.name).toBe("Expenses");
    expect(expenses.header).toEqual([
      "Account",
      "Aug 2026",
      "Sep 2026",
      "Total",
    ]);
    expect(expenses.rows).toEqual([
      ["Rent", 10000, 10000, 20000],
      ["Groceries", 1500, 1500, 3000],
      // Food's own entries only; Groceries has its own row.
      ["Food", 0, 500, 500],
      ["Total", 11500, 12000, 23500],
    ]);
    expect(incomes.name).toBe("Incomes");
    expect(incomes.rows).toEqual([
      ["Salary", 25000, 25000, 50000],
      ["Total", 25000, 25000, 50000],
    ]);
  });

  it("leaves out the month columns for a single month", () => {
    const [expenses] = incomeExpensesSheets({
      ...report,
      income: { total: 0, accounts: [] },
      spending: { total: 100, accounts: [] },
      months: [{ month: "2026-09", income: 0, spending: 100 }],
    });
    expect(expenses.header).toEqual(["Account", "Total"]);
    expect(expenses.rows).toEqual([["Total", 100]]);
  });
});

describe("incomeExpensesFileName", () => {
  it("names the period", () => {
    expect(
      incomeExpensesFileName({
        first_date: "2026-04-01",
        last_date: "2026-09-30",
      }),
    ).toBe("Income and Expenses 2026-04-01 to 2026-09-30.xlsx");
  });
});

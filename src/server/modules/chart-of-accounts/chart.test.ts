import { describe, expect, it } from "vitest";
import type { ChartAccount } from "../../../shared/index.js";
import { validateChartProposal } from "./chart.js";
import {
  chartWithAccounts,
  STARTER_CHART,
  STARTER_UNTICKED,
} from "./starter-chart.js";

const account = (
  name: string,
  account_type: ChartAccount["account_type"],
  parent: string | null = null,
): ChartAccount => ({ name, account_type, parent, note: null });

// The smallest chart that can be created.
const MINIMAL: ChartAccount[] = [
  account("Assets", "Asset"),
  account("Liabilities", "Liability"),
  account("Equity", "Equity"),
  account("Opening Balances", "Equity", "Equity"),
  account("Income", "Revenue"),
  account("Expenses", "Expense"),
];

function problems(accounts: ChartAccount[]): string[] {
  const validation = validateChartProposal(accounts);
  return validation.ok ? [] : validation.problems;
}

describe("validateChartProposal", () => {
  it("accepts the starter chart, parents ahead of children", () => {
    const validation = validateChartProposal(STARTER_CHART);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const seen = new Set<string>();
    for (const one of validation.accounts) {
      if (one.parent !== null) expect(seen).toContain(one.parent);
      seen.add(one.name);
    }
    expect(seen.size).toBe(STARTER_CHART.length);
  });

  it("puts a parent listed after its child first", () => {
    const validation = validateChartProposal([
      account("Groceries", "Expense", "Food"),
      account("Food", "Expense", "Expenses"),
      ...MINIMAL,
    ]);
    expect(validation.ok && validation.accounts.map((a) => a.name)).toEqual([
      "Assets",
      "Liabilities",
      "Equity",
      "Opening Balances",
      "Income",
      "Expenses",
      "Food",
      "Groceries",
    ]);
  });

  it("refuses names that are empty, padded or repeated", () => {
    expect(
      problems([
        ...MINIMAL,
        account(" Food", "Expense", "Expenses"),
        account("", "Expense", "Expenses"),
        account("Assets", "Asset"),
      ]),
    ).toEqual([
      '" Food" has spaces around its name.',
      "An account has no name.",
      "Assets is in the list twice.",
    ]);
  });

  it("refuses a parent that is missing or of another type", () => {
    expect(
      problems([
        ...MINIMAL,
        account("Groceries", "Expense", "Food"),
        account("Bonus", "Revenue", "Expenses"),
      ]),
    ).toEqual([
      "Groceries is under Food, which is not in the list.",
      "Bonus is a Revenue account under Expenses, which is an Expense account.",
    ]);
  });

  it("refuses a loop", () => {
    expect(
      problems([
        ...MINIMAL,
        account("Food", "Expense", "Groceries"),
        account("Groceries", "Expense", "Food"),
      ]),
    ).toEqual(["Food, Groceries are under each other in a loop."]);
  });

  it("wants a top account of each type and an Equity Opening Balances", () => {
    expect(
      problems([
        account("Assets", "Asset"),
        account("Opening Balances", "Asset", "Assets"),
      ]),
    ).toEqual([
      "There is no top Liability account.",
      "There is no top Equity account.",
      "There is no top Revenue account.",
      "There is no top Expense account.",
      "Opening Balances is an Asset account; it must be an Equity account.",
    ]);
    expect(
      problems(MINIMAL.filter((a) => a.name !== "Opening Balances")),
    ).toEqual([
      "There is no Opening Balances account; opening entries post against it.",
    ]);
  });
});

describe("the starter chart", () => {
  it("names no bank, card or fund, and keeps the groups step 2 files them under", () => {
    const names = STARTER_CHART.map((one) => one.name);
    expect(names).toEqual(
      expect.arrayContaining(["Bank Accounts", "Credit Cards", "Loans"]),
    );
    expect(names.filter((name) => /HDFC|SBI|ICICI|Zerodha/.test(name))).toEqual(
      [],
    );
  });

  it("opens unticked only accounts it has, and never a top account", () => {
    for (const name of STARTER_UNTICKED) {
      const one = STARTER_CHART.find((a) => a.name === name);
      expect(one?.parent).not.toBeNull();
    }
  });
});

describe("chartWithAccounts", () => {
  it("adds accounts under their parents, with the parent's type", () => {
    const chart = chartWithAccounts(MINIMAL, [
      { name: "Sample Savings", parent: "Assets" },
    ]);
    expect(chart.at(-1)).toEqual(account("Sample Savings", "Asset", "Assets"));
    expect(() =>
      chartWithAccounts(MINIMAL, [{ name: "X", parent: "Nowhere" }]),
    ).toThrow("No account Nowhere");
    expect(() =>
      chartWithAccounts(MINIMAL, [{ name: "Assets", parent: "Equity" }]),
    ).toThrow("already has an account Assets");
  });
});

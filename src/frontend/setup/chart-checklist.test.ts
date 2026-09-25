import { describe, expect, it } from "vitest";
import type { ChartAccount } from "../../shared/index";
import {
  chartCards,
  countsByType,
  initialTicks,
  lockedAccounts,
  tickedAccounts,
  toggleTick,
} from "./chart-checklist";

const account = (
  name: string,
  account_type: ChartAccount["account_type"],
  parent: string | null = null,
): ChartAccount => ({ name, account_type, parent, note: null });

const CHART: ChartAccount[] = [
  account("Assets", "Asset"),
  account("Equity", "Equity"),
  account("Owner", "Equity", "Equity"),
  account("Opening Balances", "Equity", "Owner"),
  account("Expenses", "Expense"),
  account("Food", "Expense", "Expenses"),
  account("Groceries", "Expense", "Food"),
  account("Dining Out", "Expense", "Food"),
  account("Children", "Expense", "Expenses"),
  account("School Fees", "Expense", "Children"),
];

const sorted = (ticks: ReadonlySet<string>) => [...ticks].sort();

describe("the chart checklist", () => {
  it("locks the top accounts, Opening Balances and what is between", () => {
    expect(sorted(lockedAccounts(CHART))).toEqual([
      "Assets",
      "Equity",
      "Expenses",
      "Opening Balances",
      "Owner",
    ]);
  });

  it("opens with everything ticked but the unticked subtrees", () => {
    const ticks = initialTicks(CHART, ["Children", "Owner"]);
    expect(ticks.has("Children")).toBe(false);
    expect(ticks.has("School Fees")).toBe(false);
    // A locked account stays ticked even when the starter names it.
    expect(ticks.has("Owner")).toBe(true);
    expect(ticks.size).toBe(CHART.length - 2);
  });

  it("unticks a subtree, and ticks the ancestors of what is ticked", () => {
    let ticks = initialTicks(CHART);
    ticks = toggleTick(CHART, ticks, "Food");
    expect(ticks.has("Groceries")).toBe(false);
    expect(ticks.has("Dining Out")).toBe(false);

    ticks = toggleTick(CHART, ticks, "Groceries");
    expect(ticks.has("Groceries")).toBe(true);
    expect(ticks.has("Food")).toBe(true);
    expect(ticks.has("Dining Out")).toBe(false);
  });

  it("leaves a locked account ticked", () => {
    const ticks = initialTicks(CHART);
    expect(toggleTick(CHART, ticks, "Owner")).toBe(ticks);
    expect(toggleTick(CHART, ticks, "Equity")).toBe(ticks);
  });

  it("lists the ticked accounts in the chart's order", () => {
    const ticks = toggleTick(CHART, initialTicks(CHART), "Food");
    expect(tickedAccounts(CHART, ticks).map((a) => a.name)).toEqual([
      "Assets",
      "Equity",
      "Owner",
      "Opening Balances",
      "Expenses",
      "Children",
      "School Fees",
    ]);
  });
});

describe("the chart's cards", () => {
  it("shows two levels and folds what is deeper under its parent", () => {
    const deep = [
      ...CHART,
      account("Snacks", "Expense", "Groceries"),
      account("Income", "Revenue"),
    ];
    const cards = chartCards(deep);
    expect(cards.map((card) => card.type)).toEqual([
      "Asset",
      "Equity",
      "Revenue",
      "Expense",
    ]);
    const expenses = cards.find((card) => card.type === "Expense")!;
    expect(
      expenses.rows.map(({ row, folded }) => [
        row.account.name,
        folded.map((below) => below.account.name),
      ]),
    ).toEqual([
      ["Expenses", []],
      ["Food", ["Groceries", "Snacks", "Dining Out"]],
      ["Children", ["School Fees"]],
    ]);
  });

  it("counts the accounts of each type", () => {
    expect(countsByType(CHART)).toEqual({
      Asset: 1,
      Liability: 0,
      Equity: 3,
      Revenue: 0,
      Expense: 6,
    });
  });
});

import { describe, expect, it } from "vitest";
import type { ChartAccount } from "../../../shared/index.js";
import { normalizeChartProposal, validateChartProposal } from "./chart.js";
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
      "Bonus is an income account under Expenses, which is an expense account.",
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
      "There is no top liability account.",
      "There is no top equity account.",
      "There is no top income account.",
      "There is no top expense account.",
      "Opening Balances is an asset account; it must be an equity account.",
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

describe("normalizeChartProposal", () => {
  const fix = (accounts: ChartAccount[]) => {
    const normalized = normalizeChartProposal(accounts);
    expect(validateChartProposal(normalized.accounts).ok).toBe(true);
    return normalized;
  };
  const named = (accounts: ChartAccount[], name: string) =>
    accounts.find((a) => a.name === name);

  it("leaves a valid chart as it is, with no notes", () => {
    expect(normalizeChartProposal(STARTER_CHART)).toEqual({
      accounts: STARTER_CHART,
      notes: [],
    });
  });

  it("adds a missing top account and Opening Balances", () => {
    const { accounts, notes } = fix(
      MINIMAL.filter(
        (a) => a.name !== "Income" && a.name !== "Opening Balances",
      ),
    );
    expect(named(accounts, "Income")).toEqual(account("Income", "Revenue"));
    expect(named(accounts, "Opening Balances")).toEqual(
      account("Opening Balances", "Equity", "Equity"),
    );
    expect(notes).toEqual([
      "Opening Balances was added: every account's starting balance is posted against it.",
      "There was no top income account, so Income was added.",
    ]);
  });

  it("makes Opening Balances an Equity account under the Equity top", () => {
    const { accounts, notes } = fix([
      ...MINIMAL.filter((a) => a.name !== "Opening Balances"),
      account("Opening Balances", "Asset", "Assets"),
    ]);
    expect(named(accounts, "Opening Balances")).toEqual(
      account("Opening Balances", "Equity", "Equity"),
    );
    expect(notes).toEqual([
      "Opening Balances was proposed as an asset account; it is an equity account now, since starting balances are posted against it.",
    ]);
  });

  it("drops a repeated name and trims names", () => {
    const { accounts, notes } = fix([
      ...MINIMAL,
      account(" Food ", "Expense", "Expenses "),
      account("Food", "Expense", "Expenses"),
      account("  ", "Expense", "Expenses"),
    ]);
    expect(accounts.filter((a) => a.name === "Food")).toEqual([
      account("Food", "Expense", "Expenses"),
    ]);
    expect(notes).toEqual([
      "Food was proposed twice; the second was left out.",
      "An account with no name was left out.",
    ]);
  });

  it("moves an account whose parent is missing, of another type or itself", () => {
    const { accounts, notes } = fix([
      ...MINIMAL,
      account("Groceries", "Expense", "Food"),
      account("Bonus", "Revenue", "Expenses"),
      account("Rent", "Expense", "Rent"),
    ]);
    expect(named(accounts, "Groceries")?.parent).toBe("Expenses");
    expect(named(accounts, "Bonus")?.parent).toBe("Income");
    expect(named(accounts, "Rent")?.parent).toBe("Expenses");
    expect(notes).toEqual([
      "Groceries was under Food, which isn't in the chart; it is under Expenses now.",
      "Bonus was under Expenses, which is an expense account; it is under Income now.",
      "Rent was under itself; it is under Expenses now.",
    ]);
  });

  it("breaks a loop at one account, keeping what hangs under it", () => {
    const { accounts, notes } = fix([
      ...MINIMAL,
      account("Dining Out", "Expense", "Food"),
      account("Food", "Expense", "Groceries"),
      account("Groceries", "Expense", "Food"),
    ]);
    expect(named(accounts, "Dining Out")?.parent).toBe("Food");
    expect(notes).toEqual([
      "Food was under one of its own sub-accounts; it is under Expenses now.",
    ]);
  });

  it("names an added top account apart from a taken name", () => {
    const { accounts } = fix([
      account("Assets", "Asset"),
      account("Income", "Asset", "Assets"),
    ]);
    expect(named(accounts, "Income 2")).toEqual(account("Income 2", "Revenue"));
  });
});

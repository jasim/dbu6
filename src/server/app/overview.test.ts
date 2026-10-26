import { parseTimeZone } from "@sapporta/shared/temporal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { overviewSchema } from "../../shared/index.js";
import { overviewReport, type OverviewAccountInput } from "./overview.js";
import { openTestLedger } from "./reports/testing.js";

const ZONE = parseTimeZone("Asia/Kolkata");

/*
 * Sample Savings opens on 31 January with 10000. From February the salary
 * comes in each month and spending goes out under one Expenses account: food
 * and rent from savings in February, food on the card and rent in March, food
 * from savings and travel on the card in April.
 */
function books() {
  const test = openTestLedger();
  const assets = test.addAccount({ name: "Assets", account_type: "Asset" });
  const savings = test.addAccount({
    name: "Sample Savings",
    account_type: "Asset",
    parent_id: assets,
  });
  const card = test.addAccount({
    name: "Sample Card",
    account_type: "Liability",
  });
  const salary = test.addAccount({
    name: "Sample Salary",
    account_type: "Revenue",
  });
  const expenses = test.addAccount({
    name: "Expenses",
    account_type: "Expense",
  });
  const food = test.addAccount({
    name: "Food",
    account_type: "Expense",
    parent_id: expenses,
  });
  const rent = test.addAccount({
    name: "Rent",
    account_type: "Expense",
    parent_id: expenses,
  });
  const travel = test.addAccount({
    name: "Travel",
    account_type: "Expense",
    parent_id: expenses,
  });
  const opening = test.addAccount({
    name: "Opening Balances",
    account_type: "Equity",
  });

  const spend = (date: string, account: number, from: number, amount: number) =>
    test.addJournal({
      date,
      description: "NOPII spend",
      entries: [
        { account_id: account, debit: amount },
        { account_id: from, credit: amount },
      ],
    });
  const paid = (date: string) =>
    test.addJournal({
      date,
      description: "NOPII salary",
      entries: [
        { account_id: savings, debit: 5000 },
        { account_id: salary, credit: 5000 },
      ],
    });

  test.addJournal({
    date: "2026-01-31",
    description: "Opening balance",
    entries: [
      { account_id: savings, debit: 10000 },
      { account_id: opening, credit: 10000 },
    ],
  });
  paid("2026-02-01");
  spend("2026-02-10", food, savings, 1000);
  spend("2026-02-15", rent, savings, 2000);
  paid("2026-03-01");
  spend("2026-03-10", food, card, 2000);
  spend("2026-03-15", rent, savings, 2000);
  paid("2026-04-01");
  spend("2026-04-10", food, savings, 1000);
  spend("2026-04-20", travel, card, 3000);

  const accounts = (savingsUntil: string | null, cardUntil: string | null) =>
    [
      {
        account_id: savings,
        name: "Sample Savings",
        kind: "bank",
        books_until: savingsUntil,
      },
      {
        account_id: card,
        name: "Sample Card",
        kind: "card",
        books_until: cardUntil,
      },
    ] satisfies OverviewAccountInput[];

  return {
    ...test,
    ids: { assets, savings, card, expenses, food },
    accounts,
  };
}

describe("overviewReport", () => {
  it("sets the month against the twelve months before it that the books cover", () => {
    const { ledger, accounts, ids } = books();

    const overview = overviewReport(ledger, {
      month: "2026-04",
      timeZone: ZONE,
      accounts: accounts("2026-04-30", "2026-04-30"),
    });

    expect(overviewSchema.parse(overview)).toEqual(overview);
    expect(overview.month).toBe("2026-04");
    expect(overview.first_month).toBe("2026-02");
    // February and March only: the months before the books started are not
    // averaged in as zeros.
    expect(overview.figures).toEqual({
      income: 5000,
      spending: 4000,
      average: { months: 2, income: 5000, spending: 3500 },
    });
    expect(overview.months).toHaveLength(12);
    expect(overview.months[0].month).toBe("2025-05");
    expect(overview.months[11]).toEqual({
      month: "2026-04",
      income: 5000,
      spending: 4000,
    });
    expect(overview.net_worth).toEqual({
      assets: 19000,
      liabilities: 5000,
      net: 14000,
      previous_net: 13000,
      // A single account under Assets and one card repeat the totals.
      asset_groups: [],
      liability_groups: [],
    });
    expect(overview.accounts).toEqual([
      {
        account_id: ids.savings,
        name: "Sample Savings",
        kind: "bank",
        balance: 19000,
        books_until: "2026-04-30",
      },
      {
        account_id: ids.card,
        name: "Sample Card",
        kind: "card",
        balance: 5000,
        books_until: "2026-04-30",
      },
    ]);
  });

  it("lists the categories under a single Expenses account, largest first", () => {
    const { ledger, accounts } = books();

    const overview = overviewReport(ledger, {
      month: "2026-04",
      timeZone: ZONE,
      accounts: accounts("2026-04-30", "2026-04-30"),
    });

    // Rent had nothing in April but is usually spent, so it stays.
    expect(
      overview.categories.map(({ name, amount, average }) => [
        name,
        amount,
        average,
      ]),
    ).toEqual([
      ["Travel", 3000, 0],
      ["Food", 1000, 1500],
      ["Rent", 0, 2000],
    ]);
  });

  it("stops at an account with entries of its own, so its amount is not lost", () => {
    const { ledger, accounts, sqlite, owner, ids } = books();
    sqlite
      .prepare(
        `INSERT INTO journal_entries
           (workspace_id, scoped_to_user_id, journal_id, account_id, debit, credit, created_at, updated_at)
         SELECT @workspace_id, @scoped_to_user_id, journal_id, @expenses, 500, 0, '', ''
         FROM journal_entries WHERE account_id = @food AND debit = 1000 LIMIT 1`,
      )
      .run({ ...owner, expenses: ids.expenses, food: ids.food });

    const overview = overviewReport(ledger, {
      month: "2026-02",
      timeZone: ZONE,
      accounts: accounts(null, null),
    });

    expect(overview.categories.map((category) => category.name)).toEqual([
      "Expenses",
    ]);
  });

  it("has no averages in the books' first month", () => {
    const { ledger, accounts } = books();

    const overview = overviewReport(ledger, {
      month: "2026-02",
      timeZone: ZONE,
      accounts: accounts(null, null),
    });

    expect(overview.figures.average).toBeNull();
    expect(overview.categories.every((c) => c.average === null)).toBe(true);
  });

  describe("with no month asked for", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows the current month, however far the books go", () => {
      const { ledger, accounts } = books();
      vi.useFakeTimers({ now: new Date("2026-06-10T12:00:00Z") });

      // The card's statement ends mid-April; June has no entries at all.
      const overview = overviewReport(ledger, {
        month: null,
        timeZone: ZONE,
        accounts: accounts("2026-04-30", "2026-04-15"),
      });

      expect(overview.month).toBe("2026-06");
      expect(overview.figures.spending).toBe(0);
    });

    it("is this month in the workspace's time zone, not the server's", () => {
      const { ledger, accounts } = books();
      // 20:00 in UTC on 30 June is 01:30 on 1 July in Kolkata.
      vi.useFakeTimers({ now: new Date("2026-06-30T20:00:00Z") });

      const overview = overviewReport(ledger, {
        month: null,
        timeZone: ZONE,
        accounts: accounts("2026-04-30", "2026-04-15"),
      });

      expect(overview.month).toBe("2026-07");
    });
  });

  it("lists where net worth sits, at the first level that branches", () => {
    const test = books();
    const { ledger, accounts, ids } = test;
    // Under Assets beside Sample Savings: a group holding a bank, and four
    // more accounts, each funded from savings.
    const banks = test.addAccount({
      name: "Sample Banks",
      account_type: "Asset",
      parent_id: ids.assets,
    });
    ["One", "Two", "Three", "Four", "Five"].forEach((name, index) => {
      const account = test.addAccount({
        name: `Sample ${name}`,
        account_type: "Asset",
        parent_id: index === 0 ? banks : ids.assets,
      });
      test.addJournal({
        date: "2026-03-05",
        description: "NOPII transfer",
        entries: [
          { account_id: account, debit: 1000 * (index + 1) },
          { account_id: ids.savings, credit: 1000 * (index + 1) },
        ],
      });
    });

    const overview = overviewReport(ledger, {
      month: "2026-04",
      timeZone: ZONE,
      accounts: accounts("2026-04-30", "2026-04-30"),
    });

    // Six accounts under Assets: the largest four, then Other for Sample Two
    // and Sample Banks, which is listed rather than the bank under it.
    expect(
      overview.net_worth.asset_groups.map((group) => [
        group.name,
        group.amount,
      ]),
    ).toEqual([
      ["Sample Five", 5000],
      ["Sample Four", 4000],
      ["Sample Savings", 4000],
      ["Sample Three", 3000],
      ["Other", 3000],
    ]);
    expect(overview.net_worth.asset_groups.at(-1)?.account_id).toBeNull();
    expect(overview.net_worth.assets).toBe(19000);
    expect(overview.net_worth.liability_groups).toEqual([]);
  });

  it("never counts drafts", () => {
    const { ledger, accounts, sqlite, owner, ids } = books();
    const before = overviewReport(ledger, {
      month: "2026-04",
      timeZone: ZONE,
      accounts: accounts("2026-04-30", "2026-04-30"),
    });
    sqlite
      .prepare(
        `INSERT INTO draft_transactions
           (workspace_id, scoped_to_user_id, date, source_narration, withdrawal, deposit,
            account_id, base_account_id, created_at, updated_at)
         VALUES (@workspace_id, @scoped_to_user_id, '2026-04-25', 'NOPII draft', 1000, 0,
            @food, @savings, '', '')`,
      )
      .run({ ...owner, food: ids.food, savings: ids.savings });

    expect(
      overviewReport(ledger, {
        month: "2026-04",
        timeZone: ZONE,
        accounts: accounts("2026-04-30", "2026-04-30"),
      }),
    ).toEqual(before);
  });
});

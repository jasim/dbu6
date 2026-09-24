import { describe, expect, it } from "vitest";
import {
  moneyFromColumns,
  parseAccount,
  UNCATEGORIZED,
  unsafeAsChrono,
  type Account,
} from "../values/index.js";
import { formatHledger, hledgerAccountNames } from "./hledger.js";
import { planJournals, type PlanRow } from "./JournalPlan.js";

const BASE = parseAccount("Sample Savings");

// A statement row as the import summary plans it: it asserts its running
// balance.
function row(
  date: string,
  money: { withdrawal: number } | { deposit: number },
  narration: string,
  account: Account,
  balance: number | null,
): PlanRow<Account> {
  return {
    transaction: {
      date,
      narration,
      ...moneyFromColumns({
        withdrawal: "withdrawal" in money ? money.withdrawal : 0,
        deposit: "deposit" in money ? money.deposit : 0,
      }),
      balance,
    },
    account,
    assertion: balance,
  };
}

describe("hledger text of a plan", () => {
  it("renders a journal per row, described by its narration, each day closing on its last row's balance", () => {
    const rows = unsafeAsChrono([
      row(
        "2026-02-01",
        { withdrawal: 100 },
        "NOPII grocer",
        parseAccount("Groceries"),
        900,
      ),
      row(
        "2026-02-01",
        { withdrawal: 50 },
        "NOPII cafe",
        parseAccount("Eating Out"),
        850,
      ),
      row(
        "2026-02-01",
        { deposit: 500 },
        "NOPII salary",
        parseAccount("Salary"),
        1350,
      ),
      row("2026-02-01", { withdrawal: 30 }, "NOPII shop", UNCATEGORIZED, 1320),
      row(
        "2026-02-02",
        { deposit: 200 },
        "NOPII refund",
        parseAccount("Refunds"),
        null,
      ),
      row(
        "2026-02-02",
        { deposit: 100 },
        "NOPII interest",
        parseAccount("Interest"),
        null,
      ),
      row(
        "2026-02-03",
        { withdrawal: 1000 },
        "NOPII plumber",
        parseAccount("Plumbing Repairs"),
        620,
      ),
    ]);

    expect(formatHledger(planJournals(rows, BASE), new Map())).toBe(
      [
        "2026-02-01 NOPII grocer",
        "    Groceries                               100.00",
        "    Sample Savings                         -100.00",
        "",
        "2026-02-01 NOPII cafe",
        "    Eating Out                               50.00",
        "    Sample Savings                          -50.00",
        "",
        "2026-02-01 NOPII salary",
        "    Sample Savings                          500.00",
        "    Salary                                 -500.00",
        "",
        "2026-02-01 NOPII shop",
        "    UNCATEGORIZED                            30.00",
        "    Sample Savings                          -30.00 = 1320.00",
        "",
        "2026-02-02 NOPII refund",
        "    Sample Savings                          200.00",
        "    Refunds                                -200.00",
        "",
        "2026-02-02 NOPII interest",
        "    Sample Savings                          100.00",
        "    Interest                               -100.00",
        "",
        "2026-02-03 NOPII plumber",
        "    Plumbing Repairs                       1000.00",
        "    Sample Savings                        -1000.00 = 620.00",
      ].join("\n"),
    );
  });

  it("formats posted journals with signed amounts, assertions, and comments", () => {
    const entry = {
      assertion: null,
      comment: null,
      sourceReference: null,
      sourceTransactionKey: null,
    };
    const output = formatHledger(
      [
        {
          date: "2026-07-09",
          description: "Expenses",
          entries: [
            {
              ...entry,
              account: "Food",
              amount: 125.5,
              comment: "Lunch",
            },
            {
              ...entry,
              account: "Bank",
              amount: -125.5,
              assertion: 999.25,
            },
          ],
        },
        {
          date: "2026-07-10",
          description: "Deposits",
          entries: [{ ...entry, account: "Bank", amount: 2000 }],
        },
      ],
      new Map(),
    );

    expect(output).toBe(
      [
        "2026-07-09 Expenses",
        "    Food                                    125.50 ; Lunch",
        "    Bank                                   -125.50 = 999.25",
        "",
        "2026-07-10 Deposits",
        "    Bank                                   2000.00",
      ].join("\n"),
    );
  });

  it("writes each account by its path down the account tree", () => {
    const hledgerNames = hledgerAccountNames([
      { id: 1, name: "Expenses", parent_id: null },
      { id: 2, name: "Food", parent_id: 1 },
      { id: 3, name: "Dining Out", parent_id: 2 },
      { id: 4, name: "Assets", parent_id: null },
      { id: 5, name: "Bank", parent_id: 4 },
      { id: 6, name: "Sample Bank With A Long Account Name", parent_id: 5 },
    ]);
    const entry = {
      assertion: null,
      comment: null,
      sourceReference: null,
      sourceTransactionKey: null,
    };
    const output = formatHledger(
      [
        {
          date: "2026-07-09",
          description: "Expenses",
          entries: [
            { ...entry, account: "Dining Out", amount: 150000 },
            {
              ...entry,
              account: "Sample Bank With A Long Account Name",
              amount: -150000,
            },
            { ...entry, account: "Not In The Ledger", amount: 0 },
          ],
        },
      ],
      hledgerNames,
    );

    expect(output).toBe(
      [
        "2026-07-09 Expenses",
        "    Expenses:Food:Dining Out             150000.00",
        // Two spaces end a name, however long, before a ten-character amount.
        "    Assets:Bank:Sample Bank With A Long Account Name  -150000.00",
        "    Not In The Ledger                         0.00",
      ].join("\n"),
    );
  });

  it("throws on a parent loop", () => {
    expect(() =>
      hledgerAccountNames([
        { id: 1, name: "Food", parent_id: 2 },
        { id: 2, name: "Dining Out", parent_id: 1 },
      ]),
    ).toThrow("parent_id loops through account 1");
  });
});

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
// balance, which the summary gives only a day's last row.
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
  it("renders a journal per row, described by its narration, asserting the balances it is given", () => {
    const rows = unsafeAsChrono([
      row(
        "2026-02-01",
        { withdrawal: 100 },
        "NOPII grocer",
        parseAccount("Groceries"),
        null,
      ),
      row(
        "2026-02-01",
        { withdrawal: 50 },
        "NOPII cafe",
        parseAccount("Eating Out"),
        null,
      ),
      row(
        "2026-02-01",
        { deposit: 500 },
        "NOPII salary",
        parseAccount("Salary"),
        null,
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

    expect(formatHledger(planJournals(rows, BASE))).toBe(
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
      sourceNarration: null,
      sourceReference: null,
      sourceTransactionKey: null,
    };
    const output = formatHledger([
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
    ]);

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

  it("describes a commented row by its comment and leaves out the statement text it was rewritten from", () => {
    const commented: PlanRow<Account> = {
      ...row(
        "2026-02-01",
        { withdrawal: 100 },
        "UPI/050505123456/SAMPLE CAFE/sample@ybl",
        parseAccount("Eating Out"),
        null,
      ),
      comment: "UPI Sample Cafe",
    };

    expect(formatHledger(planJournals(unsafeAsChrono([commented]), BASE))).toBe(
      [
        "2026-02-01 UPI Sample Cafe",
        "    Eating Out                              100.00",
        "    Sample Savings                         -100.00",
      ].join("\n"),
    );
  });

  it("follows a posted entry's comment with its source narration in parentheses when they differ, and shows the narration alone without one", () => {
    const output = formatHledger([
      {
        date: "2026-07-09",
        description: "Expenses",
        entries: [
          {
            account: "Food",
            amount: 125.5,
            assertion: null,
            comment: "Lunch",
            sourceNarration: "POS 050505 SAMPLE DINER",
            sourceReference: null,
            sourceTransactionKey: null,
          },
          {
            account: "Food",
            amount: 20,
            assertion: null,
            comment: null,
            sourceNarration: "POS 050505 SAMPLE KIOSK",
            sourceReference: null,
            sourceTransactionKey: null,
          },
          {
            account: "Food",
            amount: 30,
            assertion: null,
            comment: "Sample Bakery",
            sourceNarration: "UPI/050505000012/SAMPLE BAKERY/sample@ybl",
            sourceReference: null,
            sourceTransactionKey: null,
          },
        ],
      },
    ]);

    expect(output).toBe(
      [
        "2026-07-09 Expenses",
        "    Food                                    125.50 ; Lunch (POS 050505 SAMPLE DINER)",
        "    Food                                     20.00 ; (POS 050505 SAMPLE KIOSK)",
        "    Food                                     30.00 ; Sample Bakery",
      ].join("\n"),
    );
  });

  it("writes each account by its name in the ledger, not its path", () => {
    const entry = {
      assertion: null,
      comment: null,
      sourceNarration: null,
      sourceReference: null,
      sourceTransactionKey: null,
    };
    const output = formatHledger([
      {
        date: "2026-07-09",
        description: "Expenses",
        entries: [
          { ...entry, account: "Dining Out", amount: 150000 },
          {
            ...entry,
            account: "Assets:Sample Bank With A Long Account Name",
            amount: -150000,
          },
        ],
      },
    ]);

    expect(output).toBe(
      [
        "2026-07-09 Expenses",
        "    Dining Out                           150000.00",
        // Two spaces end a name, however long, before a ten-character amount.
        "    Assets:Sample Bank With A Long Account Name  -150000.00",
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

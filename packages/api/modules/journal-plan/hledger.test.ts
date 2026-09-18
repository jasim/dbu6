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

const BASE = parseAccount("assets:bank:sample-savings");

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
  it("renders a day's groups in order, each closing on its last row's balance", () => {
    const rows = unsafeAsChrono([
      row(
        "2026-02-01",
        { withdrawal: 100 },
        "NOPII grocer",
        parseAccount("expenses:groceries"),
        900,
      ),
      row(
        "2026-02-01",
        { withdrawal: 50 },
        "NOPII cafe",
        parseAccount("expenses:dining"),
        850,
      ),
      row(
        "2026-02-01",
        { deposit: 500 },
        "NOPII salary",
        parseAccount("income:salary"),
        1350,
      ),
      row("2026-02-01", { withdrawal: 30 }, "NOPII shop", UNCATEGORIZED, 1320),
      row(
        "2026-02-02",
        { deposit: 200 },
        "NOPII refund",
        parseAccount("income:refunds"),
        null,
      ),
      row(
        "2026-02-02",
        { deposit: 100 },
        "NOPII interest",
        parseAccount("income:interest"),
        null,
      ),
      row(
        "2026-02-03",
        { withdrawal: 1000 },
        "NOPII plumber",
        parseAccount("expenses:household:maintenance:plumbing-repairs"),
        620,
      ),
    ]);

    expect(formatHledger(planJournals(rows, BASE), new Map())).toBe(
      [
        "2026-02-01 Expenses",
        "    expenses:groceries                      100.00 ; NOPII grocer",
        "    expenses:dining                          50.00 ; NOPII cafe",
        "    assets:bank:sample-savings             -150.00 = 850.00",
        "",
        "2026-02-01 Deposits",
        "    assets:bank:sample-savings              500.00 = 1350.00",
        "    income:salary                          -500.00 ; NOPII salary",
        "",
        "2026-02-01 Expenses",
        "    UNCATEGORIZED                            30.00 ; NOPII shop",
        "    assets:bank:sample-savings              -30.00 = 1320.00",
        "",
        "2026-02-02 Deposits",
        "    assets:bank:sample-savings              300.00",
        "    income:refunds                         -200.00 ; NOPII refund",
        "    income:interest                        -100.00 ; NOPII interest",
        "",
        "2026-02-03 Expenses",
        "    expenses:household:maintenance:plumbing-repairs     1000.00 ; NOPII plumber",
        "    assets:bank:sample-savings            -1000.00 = 620.00",
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
              account: "expenses:food",
              amount: 125.5,
              comment: "Lunch",
            },
            {
              ...entry,
              account: "assets:bank",
              amount: -125.5,
              assertion: 999.25,
            },
          ],
        },
        {
          date: "2026-07-10",
          description: "Deposits",
          entries: [{ ...entry, account: "assets:bank", amount: 2000 }],
        },
      ],
      new Map(),
    );

    expect(output).toBe(
      [
        "2026-07-09 Expenses",
        "    expenses:food                           125.50 ; Lunch",
        "    assets:bank                            -125.50 = 999.25",
        "",
        "2026-07-10 Deposits",
        "    assets:bank                            2000.00",
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

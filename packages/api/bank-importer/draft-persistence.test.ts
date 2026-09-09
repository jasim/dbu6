import { describe, it, expect } from "vitest";
import type { Abacus } from "./domain/Abacus.js";
import type { CategorizedTransaction } from "./domain/CategorizedTransaction.js";
import { unsafeAsChrono as chrono } from "./domain/Chrono.js";
import { parseAccount, UNCATEGORIZED } from "./domain/Account.js";
import {
  newTransactionsSinceReconciliation,
  ReconciliationMatchError,
  toDraftRows,
} from "./draft-persistence.js";

function stubDb(accounts: Array<{ name: string; id: number }> = []) {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    all: () => accounts,
  };
  return chain;
}
const emptyDb = stubDb();

function ct(date: string, balance: number): CategorizedTransaction {
  const transaction: Abacus = {
    date,
    narration: `tx-${date}-${balance}`,
    withdrawal: 0,
    deposit: 100,
    balance,
  };
  return { transaction, account: UNCATEGORIZED };
}

describe("toDraftRows — per-date balance assertion", () => {
  it("keeps the assertion only on the last row of each date", () => {
    const { rows, expectedClosingByDate } = toDraftRows(
      emptyDb,
      parseAccount("assets:bank:hdfc"),
      chrono([
        ct("2025-01-01", 100),
        ct("2025-01-01", 200),
        ct("2025-01-02", 300),
        ct("2025-01-02", 400),
        ct("2025-01-02", 500),
      ]),
    );
    expect(rows.map((r) => r.balance_assertion_base_account)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect([...expectedClosingByDate]).toEqual([
      ["2025-01-01", 200],
      ["2025-01-02", 500],
    ]);
  });

  it("keeps the assertion on a single-row date", () => {
    const { rows, expectedClosingByDate } = toDraftRows(
      emptyDb,
      parseAccount("assets:bank:hdfc"),
      chrono([ct("2025-01-01", 100)]),
    );
    expect(rows[0].balance_assertion_base_account).toBeNull();
    expect([...expectedClosingByDate]).toEqual([["2025-01-01", 100]]);
  });

  it("nulls account_id and records a skip when LLM returns the base account", () => {
    const { rows, sameAccountSkips } = toDraftRows(
      stubDb([{ name: "assets:bank:stanc", id: 7 }]),
      parseAccount("assets:bank:stanc"),
      chrono([
        {
          transaction: {
            date: "2025-02-03",
            narration: "to my stanc",
            withdrawal: 1000,
            deposit: 0,
            balance: 500,
          },
          account: parseAccount("assets:bank:stanc"),
        },
      ]),
    );
    expect(rows[0].account_id).toBeNull();
    expect(rows[0].base_account_id).toBe(7);
    expect(sameAccountSkips).toEqual([
      {
        date: "2025-02-03",
        narration: "to my stanc",
        account: "assets:bank:stanc",
      },
    ]);
  });

  it("still drops all assertions when no row has a balance", () => {
    const { rows } = toDraftRows(
      emptyDb,
      parseAccount("assets:bank:hdfc"),
      chrono([
        {
          transaction: {
            date: "2025-01-01",
            narration: "n",
            withdrawal: 0,
            deposit: 100,
            balance: null,
          },
          account: UNCATEGORIZED,
        },
      ]),
    );
    expect(rows[0].balance_assertion_base_account).toBeNull();
  });
});

function txn(date: string, balance: number | null, deposit = 100): Abacus {
  return { date, narration: `n-${date}`, withdrawal: 0, deposit, balance };
}

describe("newTransactionsSinceReconciliation — anchoring cases", () => {
  it("returns all rows when there is no checkpoint", () => {
    const txns = [txn("2025-01-01", 100), txn("2025-01-02", 200)];
    expect(newTransactionsSinceReconciliation(chrono(txns), null)).toEqual(
      txns,
    );
  });

  it("anchors on a mid-day row whose post-balance matches", () => {
    const txns = [
      txn("2025-01-01", 100),
      txn("2025-01-02", 200),
      txn("2025-01-02", 300),
      txn("2025-01-03", 400),
    ];
    const survivors = newTransactionsSinceReconciliation(chrono(txns), {
      date: "2025-01-02",
      balance: 200,
    });
    expect(survivors.map((t) => t.balance)).toEqual([300, 400]);
  });

  it("anchors on the last of multiple same-day matches", () => {
    const txns = [
      txn("2025-01-01", 100),
      txn("2025-01-02", 200),
      txn("2025-01-02", 300),
      txn("2025-01-02", 200),
      txn("2025-01-02", 400),
      txn("2025-01-03", 500),
    ];
    const survivors = newTransactionsSinceReconciliation(chrono(txns), {
      date: "2025-01-02",
      balance: 200,
    });
    expect(survivors.map((t) => t.balance)).toEqual([400, 500]);
  });

  it("uses an opening-edge anchor when opening hint matches", () => {
    const txns = [
      txn("2025-01-02", 300),
      txn("2025-01-02", 400),
      txn("2025-01-03", 500),
    ];
    const survivors = newTransactionsSinceReconciliation(
      chrono(txns),
      { date: "2025-01-02", balance: 200 },
      { value: 200, source: "statement" },
    );
    expect(survivors.map((t) => t.balance)).toEqual([300, 400, 500]);
  });

  it("keeps first-day continuation rows when statement opening matches checkpoint", () => {
    const txns = [
      {
        date: "2026-04-01",
        narration: "IB BILLPAY DR-HDFCSI-050505XXXXXX0505",
        withdrawal: 1000000,
        deposit: 0,
        balance: 1050505.0,
      },
    ];
    const survivors = newTransactionsSinceReconciliation(
      chrono(txns),
      { date: "2026-04-01", balance: 2050505.0 },
      { value: 2050505.0, source: "statement" },
    );
    expect(survivors).toEqual(txns);
  });

  it("returns empty when the checkpoint sits past the last row", () => {
    const txns = [txn("2025-01-01", 100), txn("2025-01-02", 200)];
    const survivors = newTransactionsSinceReconciliation(chrono(txns), {
      date: "2025-01-10",
      balance: 999,
    });
    expect(survivors).toEqual([]);
  });

  it("returns empty when a re-upload anchors on the last row", () => {
    const txns = [
      txn("2025-01-01", 100),
      txn("2025-01-02", 200),
      txn("2025-01-03", 300),
    ];
    const survivors = newTransactionsSinceReconciliation(chrono(txns), {
      date: "2025-01-03",
      balance: 300,
    });
    expect(survivors).toEqual([]);
  });

  it("prefers same-day row anchor over opening-edge anchor", () => {
    const txns = [
      txn("2025-01-02", 300),
      txn("2025-01-02", 200),
      txn("2025-01-02", 400),
    ];
    const survivors = newTransactionsSinceReconciliation(
      chrono(txns),
      { date: "2025-01-02", balance: 200 },
      { value: 200, source: "manual" },
    );
    expect(survivors.map((t) => t.balance)).toEqual([400]);
  });

  it("throws when same-day rows exist but no anchor matches", () => {
    const txns = [txn("2025-01-02", 300), txn("2025-01-02", 400)];
    expect(() =>
      newTransactionsSinceReconciliation(chrono(txns), {
        date: "2025-01-02",
        balance: 200,
      }),
    ).toThrow(ReconciliationMatchError);
  });

  it("throws about null balances only when no other anchor could fit", () => {
    const txns = [txn("2025-01-02", null)];
    expect(() =>
      newTransactionsSinceReconciliation(chrono(txns), {
        date: "2025-01-02",
        balance: 200,
      }),
    ).toThrow(/has no running balance/);
  });

  it("lets opening-edge anchor rescue null same-day balances", () => {
    const txns = [txn("2025-01-02", null), txn("2025-01-03", null)];
    const survivors = newTransactionsSinceReconciliation(
      chrono(txns),
      { date: "2025-01-02", balance: 200 },
      { value: 200, source: "statement" },
    );
    expect(survivors).toHaveLength(2);
  });
});

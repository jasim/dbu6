import { describe, it, expect } from "vitest";
import type { Abacus } from "../statement/index.js";
import { moneyFromColumns, unsafeAsChrono as chrono } from "../values/index.js";
import {
  newTransactionsSinceReconciliation,
  ReconciliationMatchError,
} from "./since-checkpoint.js";

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
      200,
    );
    expect(survivors.map((t) => t.balance)).toEqual([300, 400, 500]);
  });

  it("keeps first-day continuation rows when statement opening matches checkpoint", () => {
    const txns: Abacus[] = [
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
      2050505.0,
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
      200,
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
      200,
    );
    expect(survivors).toHaveLength(2);
  });
});

// A keyed row: its key is its narration, as good as a digest here.
function keyed(
  date: string,
  key: string,
  amount: number,
  balance: number,
): Abacus {
  return {
    date,
    narration: key,
    ...moneyFromColumns({
      withdrawal: amount < 0 ? -amount : 0,
      deposit: amount > 0 ? amount : 0,
    }),
    balance,
    source_transaction_key: key,
  };
}

const newOnes = (
  txns: Abacus[],
  posted: string[] | null,
  opening: number | null = null,
) =>
  newTransactionsSinceReconciliation(
    chrono(txns),
    { date: "2026-05-10", balance: 5000 },
    opening,
    posted && new Set(posted),
  ).map((t) => t.narration);

describe("newTransactionsSinceReconciliation — the checkpoint day by key", () => {
  it("keeps a round trip back to the checkpoint after a mid-day cut", () => {
    const txns = [
      keyed("2026-05-09", "sample-prior", -100, 4000),
      keyed("2026-05-10", "sample-morning", 1000, 5000),
      keyed("2026-05-10", "NOPII-SALARY", 1000, 6000),
      keyed("2026-05-10", "NOPII-RENT", -1000, 5000),
      keyed("2026-05-11", "sample-next", -100, 4900),
    ];
    expect(newOnes(txns, ["sample-morning"])).toEqual([
      "NOPII-SALARY",
      "NOPII-RENT",
      "sample-next",
    ]);
    // By balance alone, the rent's return to 5000 hides both.
    expect(newOnes(txns, null)).toEqual(["sample-next"]);
  });

  it("keeps a failed debit and its reversal after the checkpoint", () => {
    // A paste that starts after the rows posted that day, at their balance.
    const txns = [
      keyed("2026-05-10", "UPI-sample-050505-debit", -1000, 4000),
      keyed("2026-05-10", "UPI-sample-050505-reversal", 1000, 5000),
      keyed("2026-05-10", "sample-tea", -100, 4900),
    ];
    expect(newOnes(txns, ["sample-morning"], 5000)).toEqual([
      "UPI-sample-050505-debit",
      "UPI-sample-050505-reversal",
      "sample-tea",
    ]);
  });

  it("finds nothing new on a day the books already hold whole", () => {
    const txns = [
      keyed("2026-05-09", "sample-prior", -100, 5000),
      keyed("2026-05-10", "a", -500, 4500),
      keyed("2026-05-10", "b", 500, 5000),
      keyed("2026-05-10", "c", -200, 4800),
      keyed("2026-05-10", "d", 200, 5000),
      keyed("2026-05-11", "e", -100, 4900),
    ];
    expect(newOnes(txns, ["a", "b", "c", "d"])).toEqual(["e"]);
  });

  it("does not depend on the order the statement prints the day in", () => {
    // Posted: a (-100) and b (-200), from 4800 at the day's start to 4500.
    // The new statement prints b and a on either side of a new row.
    const txns = [
      keyed("2026-05-09", "sample-prior", -100, 4800),
      keyed("2026-05-10", "b", -200, 4600),
      keyed("2026-05-10", "new", 300, 4900),
      keyed("2026-05-10", "a", -100, 4800),
    ];
    const checkpoint = { date: "2026-05-10", balance: 4500 };
    const survivors = newTransactionsSinceReconciliation(
      chrono(txns),
      checkpoint,
      null,
      new Set(["a", "b"]),
    );
    expect(survivors.map((t) => t.narration)).toEqual(["new"]);
    // By balance alone, no row lands on 4500.
    expect(() =>
      newTransactionsSinceReconciliation(chrono(txns), checkpoint),
    ).toThrow(ReconciliationMatchError);
  });

  it("falls back to the balance when a key posted that day is missing from a whole day", () => {
    // The statement starts the day before, yet 'sample-morning' isn't in it:
    // the bank reworded the row, and its new key would pass as new.
    const txns = [
      keyed("2026-05-09", "sample-prior", -100, 4000),
      keyed("2026-05-10", "sample-morning-reworded", 1000, 5000),
      keyed("2026-05-10", "sample-after", -100, 4900),
    ];
    expect(newOnes(txns, ["sample-morning"])).toEqual(["sample-after"]);
  });

  it("falls back to the balance when the rows found don't reach the checkpoint", () => {
    // A paste that starts mid-day at 4700, after the posted row: a row the
    // books never had sits between them, so this is a gap.
    const txns = [keyed("2026-05-10", "sample-late", -100, 4600)];
    expect(() => newOnes(txns, ["sample-morning"])).toThrow(
      ReconciliationMatchError,
    );
  });
});

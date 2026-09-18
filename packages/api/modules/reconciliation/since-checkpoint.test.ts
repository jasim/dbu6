import { describe, it, expect } from "vitest";
import { type Abacus, ReconciliationMatchError } from "../statement/index.js";
import { unsafeAsChrono as chrono } from "../values/index.js";
import { newTransactionsSinceReconciliation } from "./since-checkpoint.js";

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

import { describe, it, expect } from "vitest";
import type { Chrono } from "../domain/Chrono.js";
import { moneyFromColumns } from "../domain/Money.js";
import {
  analyzeDateOrder,
  computeRunningBalances,
  normalizeChronological,
  normalizeExtractedTransactions,
  type Abacus,
} from "./index.js";
import {
  BalanceMismatchError,
  SegmentBalanceMismatchError,
} from "../import-errors.js";

function row(
  date: string,
  deposit: number,
  withdrawal: number,
  balance: number | null = null,
  narration = "test",
): Abacus {
  return {
    date,
    narration,
    ...moneyFromColumns({ withdrawal, deposit }),
    balance,
  };
}

function chrono(
  txns: Abacus[],
  order?: "ascending" | "descending",
): Chrono<Abacus> {
  return normalizeChronological(txns, order);
}

describe("normalizeChronological", () => {
  it("treats 0 or 1 transactions as ascending", () => {
    expect(normalizeChronological([])).toEqual([]);
    const one = [row("2025-01-01", 100, 0)];
    expect(normalizeChronological(one)).toEqual(one);
  });

  it("leaves an already-ascending sequence alone", () => {
    const txns = [row("2025-01-01", 100, 0), row("2025-01-31", 0, 50)];
    expect(normalizeChronological(txns).map((t) => t.date)).toEqual([
      "2025-01-01",
      "2025-01-31",
    ]);
  });

  it("reverses a descending sequence to ascending", () => {
    const txns = [row("2025-01-31", 0, 50), row("2025-01-01", 100, 0)];
    expect(normalizeChronological(txns).map((t) => t.date)).toEqual([
      "2025-01-01",
      "2025-01-31",
    ]);
  });

  it("reverses intra-day order on multi-day descending input", () => {
    const txns = [
      row("2025-01-16", 0, 100, 9000, "d2-late"),
      row("2025-01-16", 0, 50, 9100, "d2-early"),
      row("2025-01-15", 0, 200, 9200, "d1-late"),
      row("2025-01-15", 0, 100, 9300, "d1-early"),
    ];
    const result = normalizeChronological(txns);
    expect(result.map((t) => t.narration)).toEqual([
      "d1-early",
      "d1-late",
      "d2-early",
      "d2-late",
    ]);
    expect(result[result.length - 1].balance).toBe(9000);
  });

  it("falls back to ascending when all rows share one date", () => {
    const txns = [
      row("2025-01-15", 0, 100, 9000, "first-in-source"),
      row("2025-01-15", 0, 50, 9100, "second-in-source"),
    ];
    const result = normalizeChronological(txns);
    expect(result.map((t) => t.narration)).toEqual([
      "first-in-source",
      "second-in-source",
    ]);
  });

  it("stable-sorts explicitly unordered sections by date", () => {
    const txns = [
      row("2025-01-01", 0, 10, null, "domestic-early"),
      row("2025-01-18", 0, 20, null, "domestic-late"),
      row("2025-01-10", 0, 30, null, "international-first"),
      row("2025-01-10", 0, 40, null, "international-second"),
      row("2025-01-11", 0, 50, null, "international-late"),
    ];

    const result = normalizeChronological(txns, "unordered");

    expect(result.map((t) => t.narration)).toEqual([
      "domestic-early",
      "international-first",
      "international-second",
      "international-late",
      "domestic-late",
    ]);
  });

  it("refuses non-monotonic source", () => {
    const txns = [
      row("2025-01-01", 0, 10, null),
      row("2025-01-10", 0, 10, null),
      row("2025-01-05", 0, 10, null),
      row("2025-01-15", 0, 10, null),
    ];
    expect(() => normalizeChronological(txns)).toThrow(
      /Minority-direction transition\(s\): rows 2->3: 2025-01-10->2025-01-05 \(descending\)/,
    );
  });
});

describe("analyzeDateOrder", () => {
  it("reports row coordinates and direction for every adjacent pair", () => {
    const txns = [
      row("2025-01-01", 0, 10),
      row("2025-01-03", 0, 10),
      row("2025-01-03", 0, 10),
      row("2025-01-02", 0, 10),
    ];

    expect(analyzeDateOrder(txns)).toEqual({
      ascendingPairs: 1,
      descendingPairs: 1,
      sameDatePairs: 1,
      transitions: [
        {
          fromRow: 1,
          toRow: 2,
          fromDate: "2025-01-01",
          toDate: "2025-01-03",
          direction: "ascending",
        },
        {
          fromRow: 2,
          toRow: 3,
          fromDate: "2025-01-03",
          toDate: "2025-01-03",
          direction: "same-date",
        },
        {
          fromRow: 3,
          toRow: 4,
          fromDate: "2025-01-03",
          toDate: "2025-01-02",
          direction: "descending",
        },
      ],
      minorityDirection: null,
      conflictingTransitions: [
        {
          fromRow: 1,
          toRow: 2,
          fromDate: "2025-01-01",
          toDate: "2025-01-03",
          direction: "ascending",
        },
        {
          fromRow: 3,
          toRow: 4,
          fromDate: "2025-01-03",
          toDate: "2025-01-02",
          direction: "descending",
        },
      ],
    });
  });
});

describe("computeRunningBalances", () => {
  it("keeps statement balances when input is already chronological", () => {
    const txns = chrono([
      row("2025-01-01", 1000, 0, 11000),
      row("2025-01-10", 0, 1000, 10000),
      row("2025-01-15", 0, 200, 9800),
    ]);
    const result = computeRunningBalances(txns, null, 9800);
    expect(result.map((t) => [t.date, t.balance])).toEqual([
      ["2025-01-01", 11000],
      ["2025-01-10", 10000],
      ["2025-01-15", 9800],
    ]);
  });

  it("throws SegmentBalanceMismatchError when adjacent printed balances disagree", () => {
    const txns = chrono([
      row("2025-01-01", 1000, 0, 11000),
      row("2025-01-10", 0, 500, 10000),
    ]);
    expect(() => computeRunningBalances(txns, null, 10000)).toThrow(
      SegmentBalanceMismatchError,
    );
  });

  it("ignores opening when all rows already have balances", () => {
    const txns = chrono([row("2025-01-01", 0, 100, 9900)]);
    const result = computeRunningBalances(txns, 99999, 9900);
    expect(result[0].balance).toBe(9900);
  });

  // The closing check absorbs sub-rupee rounding dust and catches drift past
  // it — FREEFORM-PARSE-SPEC.md §3.5, "Why tolerance = 1.0": service charges
  // rounded to paise and GST computed to fractional rupees make hard equality
  // brittle, while a rupee still catches a real mis-parse. These bracket the
  // boundary rather than sitting on it, so the exact-one-rupee case stays the
  // implementation's to define.
  it("absorbs sub-rupee rounding dust in the closing check", () => {
    const txns = chrono([row("2025-01-01", 0, 100, 9900.4)]);
    expect(() => computeRunningBalances(txns, null, 9900)).not.toThrow();
  });

  it("rejects closing drift past the one-rupee tolerance", () => {
    const txns = chrono([row("2025-01-01", 0, 100, 9901.5)]);
    expect(() => computeRunningBalances(txns, null, 9900)).toThrow(
      BalanceMismatchError,
    );
  });

  it("throws BalanceMismatchError when final drifts past tolerance", () => {
    const txns = chrono([row("2025-01-01", 0, 100, 9800)]);
    expect(() => computeRunningBalances(txns, null, 9900)).toThrow(
      BalanceMismatchError,
    );
  });

  it("walks pure-synthesis rows from opening", () => {
    const txns = chrono([
      row("2025-01-01", 1000, 0, null),
      row("2025-01-02", 0, 300, null),
      row("2025-01-03", 500, 0, null),
    ]);
    const result = computeRunningBalances(txns, 10000, 11200);
    expect(result.map((t) => t.balance)).toEqual([11000, 10700, 11200]);
  });

  it("throws when synthesis needs an opening but none is available", () => {
    const txns = chrono([row("2025-01-01", 1000, 0, null)]);
    expect(() => computeRunningBalances(txns, null, 11000)).toThrow(
      /Opening balance required/,
    );
  });

  it("refuses when neither per-row balances nor a closing balance exist", () => {
    const txns = chrono([row("2025-01-01", 1000, 0, null)]);
    expect(() => computeRunningBalances(txns, 10000, null)).toThrow(
      /Cannot verify statement integrity/,
    );
  });

  it("allows hybrid mode when closing is null and a checkpoint exists", () => {
    const txns = chrono([
      row("2025-01-01", 1000, 0, 11000),
      row("2025-01-02", 0, 300, null),
      row("2025-01-03", 500, 0, 11200),
    ]);
    expect(() => computeRunningBalances(txns, null, null)).not.toThrow();
  });

  it("uses printed checkpoints to fill an interior null row", () => {
    const txns = chrono([
      row("2025-01-01", 1000, 0, 11000),
      row("2025-01-02", 0, 300, null),
      row("2025-01-03", 500, 0, 11200),
    ]);
    const result = computeRunningBalances(txns, null, 11200);
    expect(result.map((t) => t.balance)).toEqual([11000, 10700, 11200]);
  });

  it("backward-fills a leading null row from the first printed balance", () => {
    const txns = chrono([
      row("2025-01-01", 1000, 0, null),
      row("2025-01-02", 0, 300, 10700),
    ]);
    const result = computeRunningBalances(txns, 99999, 10700);
    expect(result.map((t) => t.balance)).toEqual([11000, 10700]);
  });

  it("forward-walks trailing null rows from the last printed checkpoint", () => {
    const txns = chrono([
      row("2025-01-01", 500, 0, 10000),
      row("2025-01-02", 1000, 0, null),
      row("2025-01-03", 0, 200, null),
    ]);
    const result = computeRunningBalances(txns, null, 10800);
    expect(result.map((t) => t.balance)).toEqual([10000, 11000, 10800]);
  });

  it("throws SegmentBalanceMismatchError across a bad hybrid segment", () => {
    const txns = chrono([
      row("2025-01-01", 1000, 0, 11000),
      row("2025-01-02", 0, 300, null),
      row("2025-01-03", 0, 100, 9999),
    ]);
    expect(() => computeRunningBalances(txns, null, 9999)).toThrow(
      SegmentBalanceMismatchError,
    );
  });
});

describe("normalizeExtractedTransactions", () => {
  const transaction = (
    date: string,
    narration: string,
    balance: number | null = null,
  ): Abacus => ({
    date,
    narration,
    withdrawal: 100,
    deposit: 0,
    balance,
  });

  it("accepts date-grouped sections when rows have no printed balances", () => {
    const transactions = [
      transaction("2026-04-03", "domestic-early"),
      transaction("2026-04-18", "domestic-late"),
      transaction("2026-04-10", "international-early"),
      transaction("2026-04-11", "international-late"),
    ];

    expect(
      normalizeExtractedTransactions(transactions).map((t) => t.narration),
    ).toEqual([
      "domestic-early",
      "international-early",
      "international-late",
      "domestic-late",
    ]);
  });

  it("still rejects mixed ordering when any row has a printed balance", () => {
    const transactions = [
      transaction("2026-04-03", "first", 900),
      transaction("2026-04-18", "second", 800),
      transaction("2026-04-10", "third", 700),
    ];

    expect(() => normalizeExtractedTransactions(transactions)).toThrow(
      /Cannot determine statement order/,
    );
  });
});

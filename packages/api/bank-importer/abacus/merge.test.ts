import { describe, it, expect, vi } from "vitest";
import {
  mergeStatements,
  normalizeChronological,
  synthesizeRunningBalances,
  validateStatementBoundaries,
  verifyClosingBalance,
  type Abacus,
  type AbacusStatement,
} from "./index.js";
import {
  OverlappingStatementsError,
  StatementBoundaryMismatchError,
} from "../import-errors.js";

function stmt(
  dates: string[],
  opening: number | null,
  closing: number | null,
): AbacusStatement {
  const transactions: Abacus[] = dates.map((d, i) => ({
    date: d,
    narration: `t${i}`,
    withdrawal: 0,
    deposit: 100,
    balance: null,
  }));
  return {
    transactions: normalizeChronological(transactions, "ascending"),
    opening,
    closing,
    account: null,
    institution: null,
  };
}

function statementWithNet(
  date: string,
  opening: number,
  net: number,
  closing: number,
): AbacusStatement {
  return {
    opening,
    closing,
    account: null,
    institution: null,
    transactions: normalizeChronological(
      [
        {
          date,
          narration: `net ${net}`,
          withdrawal: net < 0 ? -net : 0,
          deposit: net > 0 ? net : 0,
          balance: null,
        },
      ],
      "ascending",
    ),
  };
}

describe("mergeStatements", () => {
  it("returns the sole part as-is (fast path, no reordering) when length is 1", () => {
    const only = stmt(["2025-01-01", "2025-01-02"], 1000, 1200);
    expect(mergeStatements([only])).toBe(only);
  });

  it("orders files by earliest transaction date, concatenates transactions in that order", () => {
    const a = stmt(["2025-02-01"], 2000, 2100);
    const b = stmt(["2025-01-01"], 1000, 1100);
    const merged = mergeStatements([a, b]);
    expect(merged.transactions.map((t) => t.date)).toEqual([
      "2025-01-01",
      "2025-02-01",
    ]);
  });

  it("takes opening from earliest file, closing from latest, drops intermediates", () => {
    const jan = stmt(["2025-01-15"], 1000, 1500);
    const feb = stmt(["2025-02-15"], 1500, 2000);
    const mar = stmt(["2025-03-15"], 2000, 2500);
    const merged = mergeStatements([mar, jan, feb]);
    expect(merged.opening).toBe(1000);
    expect(merged.closing).toBe(2500);
  });

  it("skips empty-transaction files when ordering", () => {
    const empty = stmt([], 99, 99);
    const real = stmt(["2025-01-01"], 1000, 1200);
    const merged = mergeStatements([empty, real]);
    expect(merged.opening).toBe(1000);
    expect(merged.closing).toBe(1200);
  });

  it("rejects overlapping statement ranges", () => {
    const a = stmt(["2025-01-01", "2025-01-31"], 1000, 2000);
    const b = stmt(["2025-01-31", "2025-02-28"], 2000, 3000);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => mergeStatements([a, b], ["jan.csv", "feb.csv"])).toThrow(
      OverlappingStatementsError,
    );

    expect(errorLog).toHaveBeenCalledOnce();
    const logged = String(errorLog.mock.calls[0][0]);
    expect(logged).toContain(
      '"expression": "currentPart.minDate <= previousPart.maxDate"',
    );
    expect(logged).toContain('"currentMinDate": "2025-01-31"');
    expect(logged).toContain('"previousMaxDate": "2025-01-31"');
    expect(logged).toContain('"sourceName": "jan.csv"');
    expect(logged).toContain('"sourceName": "feb.csv"');
    expect(logged).toContain('"transactionCount": 2');

    errorLog.mockRestore();
  });

  it("allows adjacent non-overlapping ranges", () => {
    const a = stmt(["2025-01-01", "2025-01-31"], 1000, 2000);
    const b = stmt(["2025-02-01", "2025-02-28"], 2000, 3000);
    expect(mergeStatements([a, b]).transactions.map((t) => t.date)).toEqual([
      "2025-01-01",
      "2025-01-31",
      "2025-02-01",
      "2025-02-28",
    ]);
  });
});

describe("validateStatementBoundaries", () => {
  it("rejects a mismatch between adjacent statement anchors", () => {
    const jan = stmt(["2025-01-31"], 1000, 1100);
    const feb = stmt(["2025-02-28"], 1200, 1300);
    expect(() =>
      validateStatementBoundaries([jan, feb], ["jan", "feb"]),
    ).toThrow(StatementBoundaryMismatchError);
  });

  it("chains four monthly credit-card statement boundaries", () => {
    const parts = [
      statementWithNet("2026-02-28", -10000.5, 4000.25, -6000.25),
      statementWithNet("2026-03-31", -6000.25, -500.5, -6500.75),
      statementWithNet("2026-04-30", -6500.75, -1500.5, -8001.25),
      statementWithNet("2026-05-31", -8001.25, -2000.25, -10001.5),
    ];
    validateStatementBoundaries(parts);
    const merged = mergeStatements(parts);
    const filled = synthesizeRunningBalances(
      merged.transactions,
      merged.opening,
    );
    verifyClosingBalance(filled, merged.closing);
    expect(filled.at(-1)?.balance).toBeCloseTo(-10001.5, 2);
  });
});

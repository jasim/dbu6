import { describe, it, expect, vi } from "vitest";
import type { Abacus } from "./domain/Abacus.js";
import type { StatementData } from "./parsers/freeform-text.js";
import {
  pickOpeningBalance,
  pickClosingBalance,
  mergeStatements,
  runStatementImport,
  validateStatementBoundaries,
  type ImportOptions,
} from "./freeform-import.js";
import {
  normalizeChronological,
  synthesizeRunningBalances,
  verifyClosingBalance,
} from "./balance-math.js";
import {
  BalanceMismatchError,
  ClosingBalanceUnavailable,
  OverlappingStatementsError,
  StatementBoundaryMismatchError,
} from "./import-errors.js";
import { parseAccount } from "./domain/Account.js";
import { parsePlainDate } from "@sapporta/shared/temporal";

describe("pickOpeningBalance", () => {
  it("returns override when provided, regardless of other sources", () => {
    expect(pickOpeningBalance(50, 100, 200)).toEqual({
      value: 50,
      source: "manual",
    });
  });

  it("falls back to LLM opening when override is null", () => {
    expect(pickOpeningBalance(null, 100, 200)).toEqual({
      value: 100,
      source: "statement",
    });
  });

  it("falls back to checkpoint when override and LLM are null", () => {
    expect(pickOpeningBalance(null, null, 200)).toEqual({
      value: 200,
      source: "checkpoint",
    });
  });

  it("returns source=none with null value when every source is empty", () => {
    expect(pickOpeningBalance(null, null, null)).toEqual({
      value: null,
      source: "none",
    });
  });

  it("treats 0 as a valid opening, not as 'missing'", () => {
    expect(pickOpeningBalance(0, 100, 200)).toEqual({
      value: 0,
      source: "manual",
    });
  });
});

describe("pickClosingBalance", () => {
  it("uses manual, statement, final printed row, then none", () => {
    expect(pickClosingBalance(10, 20, 30)).toEqual({
      value: 10,
      source: "manual",
    });
    expect(pickClosingBalance(null, 20, 30)).toEqual({
      value: 20,
      source: "statement",
    });
    expect(pickClosingBalance(null, null, 30)).toEqual({
      value: 30,
      source: "per-row",
    });
    expect(pickClosingBalance(null, null, null)).toEqual({
      value: null,
      source: "none",
    });
  });
});

function stmt(
  dates: string[],
  opening: number | null,
  closing: number | null,
): StatementData {
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

describe("statement boundary and complete-batch validation", () => {
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

  it("requires an effective closing for a credit-card import before writes", async () => {
    const part = stmt(["2026-05-01"], -100, null);
    await expect(
      runStatementImport(
        [part],
        options({ opening: null, closing: null }),
        stubImportDb(),
      ),
    ).rejects.toBeInstanceOf(ClosingBalanceUnavailable);
  });

  it("checks an incorrect manual closing before filtering an all-duplicate batch", async () => {
    const part = stmt(["2026-05-01"], -100, -110);
    await expect(
      runStatementImport(
        [part],
        options({ opening: -100, closing: -999 }),
        stubImportDb({ date: "2026-12-31", balance: -999 }),
      ),
    ).rejects.toBeInstanceOf(BalanceMismatchError);
  });

  it("returns manual precedence metadata and mismatch warnings", async () => {
    const part = stmt(["2026-05-01"], -100, -110);
    const result = await runStatementImport(
      [part],
      options({ opening: -90, closing: 10 }),
      stubImportDb({ date: "2026-12-31", balance: 10 }),
    );
    expect(result.balance_metadata).toEqual({
      opening: { extracted: -100, effective: -90, source: "manual" },
      closing: { extracted: -110, effective: 10, source: "manual" },
    });
    expect(result.warnings).toHaveLength(2);
    expect(result.draft_transaction_count).toBe(0);
  });
});

function statementWithNet(
  date: string,
  opening: number,
  net: number,
  closing: number,
): StatementData {
  return {
    opening,
    closing,
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

function options(overrides: {
  opening: number | null;
  closing: number | null;
}): ImportOptions {
  return {
    baseAccount: parseAccount("cc:stanc"),
    accountKind: "credit-card",
    balanceOverrides: overrides,
    customMappingsFilenames: [],
  };
}

function stubImportDb(checkpoint?: { date: string; balance: number }): any {
  let getCount = 0;
  const chain: any = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    all: () => [],
    get: () => {
      getCount++;
      return checkpoint && getCount <= 2
        ? {
            date: parsePlainDate(checkpoint.date),
            assertion: checkpoint.balance,
          }
        : undefined;
    },
    transaction: (run: (tx: any) => unknown) => run(chain),
  };
  return chain;
}

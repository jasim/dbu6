import { describe, it, expect, vi } from "vitest";
import {
  pickOpeningBalance,
  pickClosingBalance,
  runStatementImport,
  type ImportOptions,
} from "./freeform-import.js";
import {
  normalizeChronological,
  type Abacus,
  type AbacusStatement,
} from "./abacus/index.js";
import {
  BalanceMismatchError,
  ClosingBalanceUnavailable,
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

describe("runStatementImport", () => {
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
    expect(result.statement_period).toEqual({
      first_date: "2026-05-01",
      last_date: "2026-05-01",
    });
    expect(result.reconciliation_checkpoint).toEqual({
      date: "2026-12-31",
      balance: 10,
    });
  });
});

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

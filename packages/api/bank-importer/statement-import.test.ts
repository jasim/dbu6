import { describe, it, expect, vi } from "vitest";
import {
  pickOpeningBalance,
  pickClosingBalance,
  runStatementImport,
  type ImportOptions,
} from "./statement-import.js";
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

// The engine would detect the coding agents installed on this machine, running
// their CLIs; these tests don't categorize.
vi.mock("../llm-engine.js", () => ({
  categorizationLlm: async () => ({
    engine: null,
    caller: { ready: false, reason: "no engine in tests" },
    maxRowsPerCall: null,
  }),
}));

// runStatementImport resolves the user-config directory before the draft
// import, and dataPath() refuses to run without a data directory. Nothing here
// reads files from it.
vi.stubEnv("SAPPORTA_DATA_DIR", "/nonexistent-sapporta-data-dir");

describe("pickOpeningBalance", () => {
  it("prefers the statement's own opening over the checkpoint", () => {
    expect(pickOpeningBalance(100, 200)).toEqual({
      value: 100,
      source: "statement",
    });
  });

  it("falls back to checkpoint when the statement prints no opening", () => {
    expect(pickOpeningBalance(null, 200)).toEqual({
      value: 200,
      source: "checkpoint",
    });
  });

  it("returns source=none with null value when every source is empty", () => {
    expect(pickOpeningBalance(null, null)).toEqual({
      value: null,
      source: "none",
    });
  });

  it("treats 0 as a valid opening, not as 'missing'", () => {
    expect(pickOpeningBalance(0, 200)).toEqual({
      value: 0,
      source: "statement",
    });
  });
});

describe("pickClosingBalance", () => {
  it("uses statement, final printed row, then none", () => {
    expect(pickClosingBalance(20, 30)).toEqual({
      value: 20,
      source: "statement",
    });
    expect(pickClosingBalance(null, 30)).toEqual({
      value: 30,
      source: "per-row",
    });
    expect(pickClosingBalance(null, null)).toEqual({
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
      runStatementImport([part], options(), stubImportDb()),
    ).rejects.toBeInstanceOf(ClosingBalanceUnavailable);
  });

  it("checks the statement's closing before filtering an all-duplicate batch", async () => {
    const part = stmt(["2026-05-01"], -100, -999);
    const refusal = runStatementImport(
      [part],
      options(),
      stubImportDb({ date: "2026-12-31", balance: -999 }),
    );
    await expect(refusal).rejects.toBeInstanceOf(BalanceMismatchError);
    // The statement prints no running balances, so a gap is the likely cause.
    const error = await refusal.catch((err: BalanceMismatchError) => err);
    expect((error as BalanceMismatchError).toPayload()).toMatchObject({
      error: "balance_mismatch",
      suspected_gap: true,
    });
  });

  it("reports balance provenance, the statement period, and the checkpoint", async () => {
    const part = stmt(["2026-05-01"], -100, 0);
    const result = await runStatementImport(
      [part],
      options(),
      stubImportDb({ date: "2026-12-31", balance: 0 }),
    );
    expect(result.balance_metadata).toEqual({
      opening: { extracted: -100, effective: -100, source: "statement" },
      closing: { extracted: 0, effective: 0, source: "statement" },
    });
    expect(result.draft_transaction_count).toBe(0);
    expect(result.statement_period).toEqual({
      first_date: "2026-05-01",
      last_date: "2026-05-01",
    });
    expect(result.reconciliation_checkpoint).toEqual({
      date: "2026-12-31",
      balance: 0,
    });
  });
});

function options(): ImportOptions {
  return {
    baseAccount: parseAccount("cc:stanc"),
    accountKind: "card",
    customMappingsFilenames: [],
    gpayHtmlPath: null,
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
      return checkpoint && getCount <= 1
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

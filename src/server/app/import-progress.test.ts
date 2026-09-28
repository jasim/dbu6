import { describe, expect, it, vi } from "vitest";
import type { Abacus } from "../modules/statement/index.js";
import { parseAccount, UNCATEGORIZED } from "../modules/values/index.js";
import { nextProgress, progressBoard } from "./import-progress.js";

const row = (narration: string, withdrawal: number, deposit = 0): Abacus =>
  ({
    date: "2026-08-01",
    narration,
    withdrawal,
    deposit,
    balance: null,
  }) as Abacus;

const accounts = (progress: ReturnType<typeof nextProgress>) =>
  progress.report.rows.map(({ account, by }) => [account, by]);

describe("an import's progress", () => {
  it("follows the import: the rules, the agent's answers, then saving", () => {
    const rules = nextProgress(undefined, {
      stage: "rules",
      transactions: [
        row("SAMPLE CAFE", 100),
        row("NOPII SALARY", 0, 5000),
        row("SAMPLE SHOP", 200),
      ],
      answers: new Map([[1, parseAccount("Salary")]]),
    });
    expect(rules.report).toEqual({
      stage: "rules",
      rows: [
        {
          date: "2026-08-01",
          narration: "SAMPLE CAFE",
          amount: 100,
          direction: "out",
          account: null,
          by: null,
        },
        {
          date: "2026-08-01",
          narration: "NOPII SALARY",
          amount: 5000,
          direction: "in",
          account: "Salary",
          by: "rule",
        },
        {
          date: "2026-08-01",
          narration: "SAMPLE SHOP",
          amount: 200,
          direction: "out",
          account: null,
          by: null,
        },
      ],
    });
    const asked = nextProgress(rules, {
      stage: "llm",
      answers: new Map([
        [0, parseAccount("Food")],
        [2, UNCATEGORIZED],
      ]),
    });
    expect(asked.report.stage).toBe("llm");
    expect(accounts(asked)).toEqual([
      ["Food", "llm"],
      ["Salary", "rule"],
      [null, null],
    ]);
    expect(nextProgress(asked, { stage: "saving" }).report).toEqual({
      ...asked.report,
      stage: "saving",
    });
  });

  it("puts a second account's rows after the first's", () => {
    let progress = nextProgress(undefined, {
      stage: "rules",
      transactions: [row("SAMPLE CAFE", 100), row("SAMPLE RENT", 1000)],
      answers: new Map([[1, parseAccount("Rent")]]),
    });
    progress = nextProgress(progress, {
      stage: "llm",
      answers: new Map([[0, parseAccount("Food")]]),
    });
    progress = nextProgress(progress, { stage: "saving" });
    // The card's account: its answers name its own rows from 0.
    progress = nextProgress(progress, {
      stage: "rules",
      transactions: [row("SAMPLE FUEL", 300), row("SAMPLE CAFE", 100)],
      answers: new Map(),
    });
    progress = nextProgress(progress, {
      stage: "llm",
      answers: new Map([
        [0, parseAccount("Fuel")],
        [1, parseAccount("Food")],
      ]),
    });

    expect(accounts(progress)).toEqual([
      ["Food", "llm"],
      ["Rent", "rule"],
      ["Fuel", "llm"],
      ["Food", "llm"],
    ]);
  });

  it("stays a minute at done once the import answers", () => {
    vi.useFakeTimers();
    try {
      const board = progressBoard();
      board.start("sample-imported-050505")?.finish();
      expect(board.read("sample-imported-050505")?.stage).toBe("done");
      vi.advanceTimersByTime(60_000);
      expect(board.read("sample-imported-050505")).toBeUndefined();

      expect(board.start("no")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps an import that takes a finished one's id", () => {
    vi.useFakeTimers();
    try {
      const board = progressBoard();
      board.start("sample-reused-050505")?.finish();
      vi.advanceTimersByTime(30_000);
      board.start("sample-reused-050505");
      vi.advanceTimersByTime(30_000);
      expect(board.read("sample-reused-050505")?.stage).toBe("account");
    } finally {
      vi.useRealTimers();
    }
  });
});

import { describe, expect, it } from "vitest";
import type { ImportProgressRow, ChartAccount } from "../../shared/index";
import {
  huesByName,
  nextReveal,
  revealPace,
  ruleRows,
  tally,
  waitingGroups,
} from "./live-ledger";

const row = (
  narration: string,
  account: string | null = null,
  by: ImportProgressRow["by"] = account === null ? null : "llm",
): ImportProgressRow => ({
  date: "2026-08-01",
  narration,
  amount: 100,
  direction: "out",
  account,
  by,
});

const chart = (
  ...accounts: [name: string, parent: string | null][]
): ChartAccount[] =>
  accounts.map(([name, parent]) => ({
    name,
    parent,
    account_type: "Expense",
    note: null,
  }));

describe("the live ledger", () => {
  it("colours an account by its own name, else its parent's", () => {
    const hueOf = huesByName(
      chart(
        ["Expenses", null],
        ["Food", "Expenses"],
        ["Sample Cafe", "Food"],
        ["Sample Club", "Expenses"],
      ),
    );
    expect(hueOf("Sample Cafe")).toBe("food");
    expect(hueOf("Sample Club")).toBe("other");
    expect(hueOf("Not In The Chart")).toBe("other");
  });

  it("survives a loop in the chart", () => {
    const hueOf = huesByName(chart(["A", "B"], ["B", "A"]));
    expect(hueOf("A")).toBe("other");
  });

  it("shows the rules' rows at once", () => {
    expect(
      ruleRows([row("A", "Food", "rule"), row("B", "Food"), row("C")]),
    ).toEqual([0]);
  });

  it("lets the agent's answers out a narration at a time", () => {
    const rows = [
      row("SAMPLE CAFE", "Food"),
      row("SAMPLE SHOP"),
      row("SAMPLE CAFE", "Food"),
      row("SAMPLE FUEL", "Transport"),
    ];
    expect(nextReveal(rows, new Set())).toEqual([0, 2]);
    expect(nextReveal(rows, new Set([0, 2]))).toEqual([3]);
    expect(nextReveal(rows, new Set([0, 2, 3]))).toEqual([]);
    expect(waitingGroups(rows, new Set())).toBe(2);
  });

  it("spreads a call's answers out, and catches up quickly at the end", () => {
    expect(revealPace(50, false)).toBe(120);
    expect(revealPace(1, false)).toBe(600);
    expect(revealPace(1000, false)).toBe(80);
    expect(revealPace(10, true)).toBe(120);
    expect(revealPace(1000, true)).toBe(16);
  });

  it("keeps a hue's accounts together in the bar", () => {
    const rows = [
      row("A", "Fuel"),
      row("B", "Groceries"),
      row("C", "Dining Out"),
      row("D", "Groceries"),
    ];
    const hueOf = huesByName(
      chart(
        ["Food", null],
        ["Groceries", "Food"],
        ["Dining Out", "Food"],
        ["Transport", null],
        ["Fuel", "Transport"],
      ),
    );
    expect(
      tally(rows, new Set([0, 1, 2, 3]), hueOf).segments.map(
        (one) => one.account,
      ),
    ).toEqual(["Groceries", "Dining Out", "Fuel"]);
  });

  it("tallies only the rows shown, most first", () => {
    const rows = [
      row("A", "Food"),
      row("B", "Transport"),
      row("C", "Food"),
      row("D"),
    ];
    const hueOf = huesByName(chart(["Food", null], ["Transport", null]));
    expect(tally(rows, new Set([0, 1, 2]), hueOf)).toEqual({
      segments: [
        { account: "Food", hue: "food", count: 2 },
        { account: "Transport", hue: "transport", count: 1 },
      ],
      waiting: 1,
      total: 4,
    });
    expect(tally(rows, new Set(), hueOf).waiting).toBe(4);
  });
});

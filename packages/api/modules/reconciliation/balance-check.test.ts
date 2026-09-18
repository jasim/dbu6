import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { sameAmount, unsafeAsChrono as chrono } from "../values/index.js";
import { assertionFailsSql, dayClosings } from "./balance-check.js";

describe("dayClosings", () => {
  it("takes the last balance each date prints, skipping rows that print none", () => {
    const closings = dayClosings(
      chrono([
        { date: "2026-05-07", balance: 1000 },
        { date: "2026-05-07", balance: 1500 },
        { date: "2026-05-07", balance: null },
        { date: "2026-05-08", balance: null },
        { date: "2026-05-09", balance: 2000 },
      ]),
    );

    expect([...closings]).toEqual([
      ["2026-05-07", 1500],
      ["2026-05-09", 2000],
    ]);
  });
});

describe("assertionFailsSql", () => {
  it("fails exactly when the balances are not the same amount", () => {
    const pairs: [number, number][] = [
      [0.1 + 0.2, 0.3],
      [1000, 1000.001],
      [1000, 1000.01],
      [1000, 900],
    ];
    const sqlite = new Database(":memory:");
    const fails = pairs.map(
      ([running, asserted]) =>
        sqlite
          .prepare(
            `SELECT ${assertionFailsSql("@running", "@asserted")} AS fails`,
          )
          .get({ running, asserted }) as { fails: number },
    );

    expect(fails.map((row) => row.fails === 1)).toEqual(
      pairs.map(([running, asserted]) => !sameAmount(running, asserted)),
    );
    expect(fails.map((row) => row.fails)).toEqual([0, 0, 1, 1]);
  });
});

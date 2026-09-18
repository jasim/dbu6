import { describe, expect, it } from "vitest";
import {
  amount,
  direction,
  isWithdrawal,
  moneyFromColumns,
  sameAmount,
} from "./Money.js";

describe("sameAmount", () => {
  it("treats amounts less than half a paisa apart as the same", () => {
    expect(sameAmount(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameAmount(1000, 1000.004)).toBe(true);
    expect(sameAmount(1000, 1000.01)).toBe(false);
    expect(sameAmount(1000, 999.99)).toBe(false);
  });
});

describe("moneyFromColumns", () => {
  it("reads a stored withdrawal or deposit as money moving one way", () => {
    const out = moneyFromColumns({ withdrawal: 1000, deposit: 0 });
    const into = moneyFromColumns({ withdrawal: 0, deposit: 2500 });

    expect([direction(out), amount(out), isWithdrawal(out)]).toEqual([
      "withdrawal",
      1000,
      true,
    ]);
    expect([direction(into), amount(into), isWithdrawal(into)]).toEqual([
      "deposit",
      2500,
      false,
    ]);
  });

  it("refuses columns that move both ways or neither", () => {
    expect(() => moneyFromColumns({ withdrawal: 1000, deposit: 500 })).toThrow(
      /one positive amount and one zero/,
    );
    expect(() => moneyFromColumns({ withdrawal: 0, deposit: 0 })).toThrow(
      /one positive amount and one zero/,
    );
  });
});

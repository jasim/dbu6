import { describe, expect, it } from "vitest";
import { amount, direction, isWithdrawal, moneyFromColumns } from "./Money.js";

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

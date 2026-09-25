import { describe, expect, it } from "vitest";
import { firstOpenStep, setupSteps } from "./steps";

const status = (accounts: number, preset: number, ready: number) => ({
  accounts,
  preset_accounts: preset,
  ready_accounts: ready,
});

describe("the setup wizard's steps", () => {
  it("opens on the first step the books haven't done", () => {
    expect(firstOpenStep(status(0, 0, 0))).toBe("accounts");
    expect(firstOpenStep(status(40, 0, 0))).toBe("banks");
    expect(firstOpenStep(status(40, 2, 1))).toBe("statements");
    expect(firstOpenStep(status(40, 2, 2))).toBe("statements");
  });

  it("marks each step from the books, and the one shown as current", () => {
    const steps = setupSteps(status(40, 2, 1), "banks");
    expect(steps.map((step) => [step.status, step.detail])).toEqual([
      ["done", "40 accounts"],
      ["current", "2 banks and cards"],
      ["waiting", "1 of 2 ready"],
      ["waiting", "What each account held when you start"],
    ]);
    expect(setupSteps(status(40, 2, 2), "accounts")[2].status).toBe("done");
  });

  it("marks nothing done before the status has loaded", () => {
    expect(setupSteps(null, "accounts").map((step) => step.status)).toEqual([
      "current",
      "waiting",
      "waiting",
      "waiting",
    ]);
  });
});

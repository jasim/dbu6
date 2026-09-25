import { describe, expect, it } from "vitest";
import type { SetupStatus } from "../../shared/index";
import { firstOpenStep, railSteps, stepDone } from "./steps";

const status = (
  accounts: number,
  banks: number,
  imported: number,
  drafts: number,
): SetupStatus => ({
  accounts,
  statement_accounts: banks,
  imported_accounts: imported,
  drafts,
  to_review: [],
});

describe("the setup wizard's steps", () => {
  it("opens on the first step the books haven't done, else Review", () => {
    expect(firstOpenStep(status(0, 0, 0, 0))).toBe("accounts");
    expect(firstOpenStep(status(40, 0, 0, 0))).toBe("banks");
    expect(firstOpenStep(status(40, 2, 1, 42))).toBe("statements");
    expect(firstOpenStep(status(40, 2, 2, 42))).toBe("review");
    expect(firstOpenStep(status(40, 2, 2, 0))).toBe("review");
  });

  it("is done with Review once every bank or card is in and nothing waits", () => {
    expect(stepDone("review", status(40, 2, 2, 0))).toBe(true);
    expect(stepDone("review", status(40, 2, 2, 42))).toBe(false);
    expect(stepDone("review", status(40, 2, 1, 0))).toBe(false);
    // No bank or card: nothing is imported, however few drafts.
    expect(stepDone("statements", status(40, 0, 0, 0))).toBe(false);
    expect(stepDone("review", status(40, 0, 0, 0))).toBe(false);
  });

  it("marks each step from the books, with a status line", () => {
    const steps = railSteps(status(72, 2, 1, 42), "banks");
    expect(steps.map((step) => [step.title, step.mark, step.status])).toEqual([
      ["Chart of accounts", "done", "72 accounts"],
      ["Banks & cards", "done", "2 added"],
      ["First statements", "todo", "1 of 2 imported"],
      ["Review", "todo", "42 to review"],
    ]);
    expect(steps.map((step) => step.current)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(steps.map((step) => step.to)).toEqual([
      "/setup/accounts",
      "/setup/banks",
      "/setup/statements",
      "/setup/review",
    ]);
  });

  it("says what is missing on new books", () => {
    expect(
      railSteps(status(0, 0, 0, 0), "accounts").map((step) => [
        step.mark,
        step.status,
      ]),
    ).toEqual([
      ["current", "Not created"],
      ["todo", "None yet"],
      ["todo", "Add a bank or card first"],
      ["todo", "Nothing yet"],
    ]);
    expect(railSteps(status(72, 2, 2, 0), "review")[3]).toMatchObject({
      mark: "done",
      status: "Done",
    });
  });

  it("marks nothing done before the status has loaded", () => {
    expect(
      railSteps(null, "accounts").map((step) => [step.mark, step.status]),
    ).toEqual([
      ["current", ""],
      ["todo", ""],
      ["todo", ""],
      ["todo", ""],
    ]);
  });
});

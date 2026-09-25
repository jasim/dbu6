import { describe, expect, it } from "vitest";
import type { SetupStatus } from "../../shared/index";
import { balancesHref, railSteps, stepDone } from "./steps";

const status = (
  accounts: number,
  banks: number,
  imported: number,
  drafts: number,
  otherBalances = 0,
): SetupStatus => ({
  accounts,
  statement_accounts: banks,
  imported_accounts: imported,
  drafts,
  to_review: [],
  other_balances: otherBalances,
});

describe("the setup wizard's steps", () => {
  it("never waits for the optional other balances", () => {
    expect(stepDone("balances", status(40, 2, 2, 0))).toBe(false);
    expect(stepDone("review", status(40, 2, 2, 0))).toBe(true);
    expect(stepDone("balances", status(40, 2, 2, 0, 3))).toBe(true);
  });

  it("links to one account's row on the other balances step", () => {
    expect(balancesHref("Assets:Bank:Sample Bank")).toBe(
      "/setup/balances?account=Assets%3ABank%3ASample+Bank",
    );
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
      ["Other balances", "todo", "Optional"],
      ["Review", "todo", "42 to review"],
    ]);
    expect(steps.map((step) => step.current)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(steps.map((step) => step.to)).toEqual([
      "/setup/accounts",
      "/setup/banks",
      "/setup/statements",
      "/setup/balances",
      "/setup/review",
    ]);
  });

  it("marks the other balances done once any is recorded", () => {
    expect(railSteps(status(72, 2, 2, 0, 3), "review")[3]).toMatchObject({
      title: "Other balances",
      mark: "done",
      status: "3 recorded",
    });
    expect(railSteps(status(72, 2, 2, 0), "balances")[3]).toMatchObject({
      mark: "current",
      status: "Optional",
    });
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
      ["todo", "Optional"],
      ["todo", "Nothing yet"],
    ]);
    expect(railSteps(status(72, 2, 2, 0), "review")[4]).toMatchObject({
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
      ["todo", ""],
    ]);
  });
});

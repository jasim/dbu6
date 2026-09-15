import { describe, expect, it } from "vitest";
import { branchTops } from "./account-tree.js";

function tops(accounts: { account_id: number; parent_id: number | null }[]) {
  return Object.fromEntries(
    Array.from(branchTops(accounts), ([id, top]) => [id, top.account_id]),
  );
}

describe("branchTops", () => {
  it("finds the furthest ancestor, however deep the branch", () => {
    expect(
      tops([
        { account_id: 1, parent_id: null },
        { account_id: 2, parent_id: 1 },
        { account_id: 3, parent_id: 2 },
        { account_id: 4, parent_id: 3 },
        { account_id: 5, parent_id: null },
      ]),
    ).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 5 });
  });

  it("stops at a parent that isn't in the list", () => {
    expect(
      tops([
        { account_id: 2, parent_id: 1 },
        { account_id: 3, parent_id: 2 },
      ]),
    ).toEqual({ 2: 2, 3: 2 });
  });

  it("gives every account in a parent loop one top and returns", () => {
    const result = tops([
      { account_id: 1, parent_id: 2 },
      { account_id: 2, parent_id: 1 },
      { account_id: 3, parent_id: 1 },
    ]);

    expect(Object.keys(result)).toEqual(["1", "2", "3"]);
    expect([1, 2]).toContain(result[3]);
  });
});

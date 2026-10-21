import { describe, expect, it } from "vitest";
import { accountParentPaths, parentPathColumnId } from "./account-path.js";

describe("accountParentPaths", () => {
  const chart = [
    { id: 1, name: "Expenses", parent_id: null },
    { id: 2, name: "Kitchen", parent_id: 1 },
    { id: 3, name: "Groceries", parent_id: 2 },
    { id: 4, name: "Vegetables", parent_id: 3 },
  ];

  it("names each account's parents from the top down", () => {
    const paths = accountParentPaths(chart);
    expect(paths.get(1)).toBeNull();
    expect(paths.get(2)).toBe("Expenses");
    expect(paths.get(3)).toBe("Expenses > Kitchen");
    expect(paths.get(4)).toBe("Expenses > Kitchen > Groceries");
  });

  it("gives the same paths whatever order the accounts come in", () => {
    expect(accountParentPaths([...chart].reverse())).toEqual(
      accountParentPaths(chart),
    );
  });

  it("stops at a parent that isn't among the accounts", () => {
    const paths = accountParentPaths([
      { id: 2, name: "Kitchen", parent_id: 1 },
      { id: 3, name: "Groceries", parent_id: 2 },
    ]);
    expect(paths.get(2)).toBeNull();
    expect(paths.get(3)).toBe("Kitchen");
  });

  it("ends a looping path where it would repeat", () => {
    const paths = accountParentPaths([
      { id: 1, name: "A", parent_id: 2 },
      { id: 2, name: "B", parent_id: 1 },
    ]);
    expect(paths.get(1)).toBe("B");
    expect(paths.get(2)).toBeNull();
  });
});

describe("parentPathColumnId", () => {
  it("suffixes the name column", () => {
    expect(parentPathColumnId("account_name")).toBe("account_name_parent_path");
  });
});

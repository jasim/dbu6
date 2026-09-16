import { describe, expect, it } from "vitest";
import {
  accountTree,
  branchTops,
  subtree,
  type AccountNode,
} from "./account-tree.js";

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

  it("throws on a parent loop, naming it from its lowest id", () => {
    expect(() =>
      tops([
        { account_id: 3, parent_id: 2 },
        { account_id: 2, parent_id: 1 },
        { account_id: 1, parent_id: 2 },
      ]),
    ).toThrow("parent_id loops through accounts 1 → 2 → 1");
  });

  it("throws on an account that is its own parent", () => {
    expect(() => tops([{ account_id: 1, parent_id: 1 }])).toThrow(
      "parent_id loops through accounts 1 → 1",
    );
  });
});

describe("subtree", () => {
  const accounts = [
    { account_id: 1, parent_id: null },
    { account_id: 2, parent_id: 1 },
    { account_id: 3, parent_id: 2 },
    { account_id: 4, parent_id: 1 },
    { account_id: 5, parent_id: null },
  ];
  const ids = (accountId: number) =>
    subtree(accounts, accountId).map((account) => account.account_id);

  it("takes the account and everything under it, parents first", () => {
    expect(ids(1)).toEqual([1, 2, 3, 4]);
    expect(ids(2)).toEqual([2, 3]);
    expect(ids(5)).toEqual([5]);
  });

  it("is empty for an account that isn't in the list", () => {
    expect(ids(9)).toEqual([]);
  });

  it("throws on a parent loop outside the account's own branch", () => {
    expect(() =>
      subtree(
        [
          ...accounts,
          { account_id: 6, parent_id: 7 },
          { account_id: 7, parent_id: 8 },
          { account_id: 8, parent_id: 7 },
        ],
        5,
      ),
    ).toThrow("parent_id loops through accounts 7 → 8 → 7");
  });
});

type Account = {
  account_id: number;
  parent_id: number | null;
  name: string;
  amount: number;
};

/** Each node as [name, own, total, children]. */
type Shape = [string, number, number, Shape[]];

function shape(nodes: AccountNode<Account>[]): Shape[] {
  return nodes.map((node) => [
    node.account.name,
    node.own,
    node.total,
    shape(node.children),
  ]);
}

function account(
  account_id: number,
  name: string,
  parent_id: number | null,
  amount = 0,
): Account {
  return { account_id, name, parent_id, amount };
}

describe("accountTree", () => {
  it("totals every entry on an account and below it, level by level", () => {
    expect(
      shape(
        accountTree([
          account(1, "food", null, 500),
          account(2, "groceries", 1, 3000),
          account(3, "dining", 1, 1000),
          account(4, "restaurants", 3, 1500),
          account(5, "rent", null, 20000),
        ]),
      ),
    ).toEqual([
      ["rent", 20000, 20000, []],
      [
        "food",
        500,
        6000,
        [
          ["groceries", 3000, 3000, []],
          ["dining", 1000, 2500, [["restaurants", 1500, 1500, []]]],
        ],
      ],
    ]);
  });

  it("keeps a parent without entries of its own and drops empty subtrees", () => {
    expect(
      shape(
        accountTree([
          account(1, "expenses", null),
          account(2, "food", 1),
          account(3, "groceries", 2, 3000),
          account(4, "travel", 1),
          account(5, "flights", 4),
          account(6, "unused", null),
        ]),
      ),
    ).toEqual([
      [
        "expenses",
        0,
        3000,
        [["food", 0, 3000, [["groceries", 3000, 3000, []]]]],
      ],
    ]);
  });

  it("ranks ties by name and puts totals running the other way last", () => {
    expect(
      shape(
        accountTree([
          account(1, "b", null, 100),
          account(2, "refunds", null, -50),
          account(3, "a", null, 100),
          account(4, "c", null, 400),
        ]),
      ).map(([name]) => name),
    ).toEqual(["c", "a", "b", "refunds"]);
  });

  it("treats an account whose parent isn't in the list as a top", () => {
    expect(
      shape(accountTree([account(2, "salary", 1, 100)])).map(([name]) => name),
    ).toEqual(["salary"]);
  });

  it("throws on a parent loop, even one with no amounts", () => {
    expect(() =>
      accountTree([
        account(1, "food", 4, 500),
        account(2, "groceries", 1, 3000),
        account(3, "dining", 1),
        account(4, "restaurants", 3),
      ]),
    ).toThrow("parent_id loops through accounts 1 → 4 → 3 → 1");
  });
});

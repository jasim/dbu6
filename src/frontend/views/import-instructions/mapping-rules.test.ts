import { describe, expect, it } from "vitest";
import {
  aiExample,
  containsExample,
  exactByAccount,
  exactExample,
  findIncludes,
  type ReadMappings,
} from "./mapping-rules";

const mappings: ReadMappings = {
  state: "read",
  filename: "transaction_mappings.mjs",
  exact: [
    { narration: "SAMPLE CAFE 050505", account: "Food", in_ledger: true },
    { narration: "NOPII SHOP", account: "Sample Gone", in_ledger: false },
    { narration: "NOPII BAKERY", account: "Food", in_ledger: true },
  ],
  includes: [
    {
      account: "Sample Card",
      in_ledger: true,
      direction: "withdrawal",
      values: ["CARD PAYMENT 050505"],
    },
    {
      account: "Sample Gone",
      in_ledger: false,
      direction: null,
      values: ["sample-payee@okaxis"],
    },
  ],
};

const empty: ReadMappings = { ...mappings, exact: [], includes: [] };

describe("the exact rules by account", () => {
  it("groups the narrations under their account, most rules first", () => {
    expect(
      exactByAccount(mappings).map((row) => [row.account, row.narrations]),
    ).toEqual([
      ["Food", ["SAMPLE CAFE 050505", "NOPII BAKERY"]],
      ["Sample Gone", ["NOPII SHOP"]],
    ]);
  });

  it("finds narrations, or every narration of an account it finds, ignoring case", () => {
    expect(
      exactByAccount(mappings, "cafe").map((row) => [row.account, row.found]),
    ).toEqual([["Food", ["SAMPLE CAFE 050505"]]]);
    expect(exactByAccount(mappings, " FOOD ").map((row) => row.found)).toEqual([
      ["SAMPLE CAFE 050505", "NOPII BAKERY"],
    ]);
  });
});

describe("the includes rules", () => {
  it("keeps each rule's place in the checking order", () => {
    expect(
      findIncludes(mappings, "OKAXIS").map((rule) => rule.position),
    ).toEqual([2]);
    expect(findIncludes(mappings).map((rule) => rule.position)).toEqual([1, 2]);
  });

  it("finds values and accounts, ignoring case", () => {
    expect(
      findIncludes(mappings, "sample card").map((rule) => rule.values),
    ).toEqual([["CARD PAYMENT 050505"]]);
  });
});

describe("the examples", () => {
  it("come from the user's first rules", () => {
    expect(exactExample(mappings)).toEqual({
      kind: "whole",
      text: "SAMPLE CAFE 050505",
      account: "Food",
      sample: false,
    });
    expect(containsExample(mappings)).toEqual({
      kind: "phrase",
      text: "CARD PAYMENT 050505",
      account: "Sample Card",
      sample: false,
    });
  });

  it("are made up, and say so, when there are no rules", () => {
    expect(exactExample(empty).sample).toBe(true);
    expect(containsExample(empty).sample).toBe(true);
  });

  it("name an account for the AI only when the books have it", () => {
    const account = (name: string, parent: string | null = null) => ({
      name,
      parent,
    });
    expect(aiExample([account("Food")]).account).toBe("Food");
    expect(
      aiExample([account("Food"), account("Groceries", "Food")]).account,
    ).toBeNull();
    expect(aiExample([account("Groceries")]).account).toBeNull();
  });
});

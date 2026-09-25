import { describe, expect, it } from "vitest";
import {
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
  it("groups the narrations under their account, those not in the books first, then most rules first", () => {
    expect(
      exactByAccount(mappings).map((row) => [row.account, row.narrations]),
    ).toEqual([
      ["Sample Gone", ["NOPII SHOP"]],
      ["Food", ["SAMPLE CAFE 050505", "NOPII BAKERY"]],
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
      text: "SAMPLE CAFE 050505",
      longer: "SAMPLE CAFE 050505 050505",
    });
    expect(containsExample(mappings)).toEqual({
      phrase: "CARD PAYMENT 050505",
      before: "NEFT-",
      after: "-050505",
    });
  });

  it("never show a UPI address as the exact example, which matches inside longer descriptions", () => {
    const upiFirst: ReadMappings = {
      ...mappings,
      exact: [
        { narration: "sample@okbank", account: "Food", in_ledger: true },
        ...mappings.exact,
      ],
    };
    expect(exactExample(upiFirst).text).toBe("SAMPLE CAFE 050505");
  });

  it("are made up when there are no rules", () => {
    expect(exactExample(empty).text).toBe("ACME GROCERS");
    expect(containsExample(empty).phrase).toBe("CITY POWER");
  });
});

import { describe, expect, it } from "vitest";
import {
  containsExample,
  exactByAccount,
  exactExample,
  findIncludes,
  ruleLimits,
  type ReadMappings,
} from "./mapping-rules";

const EVERY = { every: true } as const;
const on = (...names: string[]) => ({
  every: false as const,
  accounts: names,
});

const exact = (
  narrations: string[],
  map_to_account: string,
  more: Partial<ReadMappings["exact"][number]> = {},
): ReadMappings["exact"][number] => ({
  statement: EVERY,
  money: "either",
  narrations,
  map_to_account,
  in_ledger: true,
  ...more,
});

const mappings: ReadMappings = {
  state: "read",
  filename: "transaction_mappings.mjs",
  exact: [
    exact(["SAMPLE CAFE 050505"], "Food"),
    exact(["NOPII SHOP"], "Sample Gone", { in_ledger: false }),
    exact(["NOPII BAKERY"], "Food"),
    exact(["NOPII BAKERY 2"], "Food", {
      statement: on("Sample Savings"),
      money: "out",
    }),
  ],
  contains: [
    {
      statement: on("Sample Savings"),
      money: "out",
      contains: ["CARD PAYMENT 050505"],
      amount: null,
      map_to_account: "Sample Card",
      in_ledger: true,
    },
    {
      statement: EVERY,
      money: "either",
      contains: ["sample-payee@okaxis"],
      amount: null,
      map_to_account: "Sample Gone",
      in_ledger: false,
    },
  ],
};

const empty: ReadMappings = { ...mappings, exact: [], contains: [] };

describe("the exact rules by account and statement", () => {
  it("groups the narrations under their account, statement and money, those whose account the books don't have first, then most first", () => {
    expect(
      exactByAccount(mappings).map((row) => [
        row.rule.map_to_account,
        ruleLimits(row.rule),
        row.narrations,
      ]),
    ).toEqual([
      ["Sample Gone", "On every statement", ["NOPII SHOP"]],
      ["Food", "On every statement", ["SAMPLE CAFE 050505", "NOPII BAKERY"]],
      ["Food", "On Sample Savings · money out", ["NOPII BAKERY 2"]],
    ]);
  });

  it("finds narrations, or every narration of an account or statement it finds, ignoring case", () => {
    expect(
      exactByAccount(mappings, "cafe").map((row) => [
        row.rule.map_to_account,
        row.found,
      ]),
    ).toEqual([["Food", ["SAMPLE CAFE 050505"]]]);
    expect(exactByAccount(mappings, " FOOD ").map((row) => row.found)).toEqual([
      ["SAMPLE CAFE 050505", "NOPII BAKERY"],
      ["NOPII BAKERY 2"],
    ]);
    expect(
      exactByAccount(mappings, "sample savings").map((row) => row.found),
    ).toEqual([["NOPII BAKERY 2"]]);
  });
});

describe("the contains rules", () => {
  it("keeps each rule's place in the checking order", () => {
    expect(
      findIncludes(mappings, "OKAXIS").map((rule) => rule.position),
    ).toEqual([2]);
    expect(findIncludes(mappings).map((rule) => rule.position)).toEqual([1, 2]);
  });

  it("finds texts, accounts and statements, ignoring case", () => {
    expect(
      findIncludes(mappings, "sample card").map((rule) => rule.contains),
    ).toEqual([["CARD PAYMENT 050505"]]);
    expect(
      findIncludes(mappings, "on sample savings").map((rule) => rule.position),
    ).toEqual([1]);
  });

  it("say what each reads, statement first", () => {
    expect(
      ruleLimits({
        statement: on("Sample Card", "Sample Savings"),
        money: "in",
        amount: { min: null, max: 5000 },
      }),
    ).toMatch(/^On Sample Card, Sample Savings · money in · /);
    expect(
      ruleLimits({ statement: EVERY, money: "either", amount: null }),
    ).toBe("On every statement");
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
      exact: [exact(["sample@okbank"], "Food"), ...mappings.exact],
    };
    expect(exactExample(upiFirst).text).toBe("SAMPLE CAFE 050505");
  });

  it("are made up when there are no rules", () => {
    expect(exactExample(empty).text).toBe("ACME GROCERS");
    expect(containsExample(empty).phrase).toBe("CITY POWER");
  });
});

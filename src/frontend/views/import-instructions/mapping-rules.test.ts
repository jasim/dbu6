import { describe, expect, it } from "vitest";
import {
  accountsNotInLedger,
  filterMappings,
  ruleCount,
  type ReadMappings,
} from "./mapping-rules";

const mappings: ReadMappings = {
  state: "read",
  filename: "transaction_mappings.mjs",
  exact: [
    { narration: "SAMPLE CAFE 050505", account: "Food", in_ledger: true },
    { narration: "NOPII SHOP", account: "Sample Gone", in_ledger: false },
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

describe("the transaction mapping rules", () => {
  it("counts exact and includes rules together", () => {
    expect(ruleCount(mappings)).toBe(4);
  });

  it("filters on narrations, values and accounts, ignoring case", () => {
    const cafe = filterMappings(mappings, "cafe");
    expect(cafe.exact.map((rule) => rule.narration)).toEqual([
      "SAMPLE CAFE 050505",
    ]);
    expect(cafe.includes).toEqual([]);

    const gone = filterMappings(mappings, " sample gone ");
    expect(gone.exact).toHaveLength(1);
    expect(gone.includes.map((rule) => rule.values)).toEqual([
      ["sample-payee@okaxis"],
    ]);
  });

  it("keeps each includes rule's place in the checking order", () => {
    expect(
      filterMappings(mappings, "OKAXIS").includes.map((rule) => rule.position),
    ).toEqual([2]);
    expect(
      filterMappings(mappings, "").includes.map((rule) => rule.position),
    ).toEqual([1, 2]);
  });

  it("lists the accounts the ledger doesn't have, with their rule counts", () => {
    expect(accountsNotInLedger(mappings)).toEqual([
      { account: "Sample Gone", rules: 2 },
    ]);
  });
});

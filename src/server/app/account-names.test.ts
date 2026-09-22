import { describe, expect, it } from "vitest";
import { accountLabel, importablePaths } from "./account-names.js";

const presets = [
  {
    name: "Bank PDF",
    base_account: "Sample Bank",
    custom_mappings_filenames: [],
  },
  {
    name: "Bank XLS",
    base_account: "Sample Bank",
    custom_mappings_filenames: [],
    is_credit_card: true,
  },
  {
    name: "Only Card Statement",
    base_account: "Only Card",
    custom_mappings_filenames: [],
    is_credit_card: true,
  },
  {
    name: "Sample Savings Statement",
    base_account: "Sample Savings",
    custom_mappings_filenames: [],
  },
];

describe("importablePaths", () => {
  it("keeps one path per base account, in first-seen order", () => {
    expect(importablePaths(presets)).toEqual([
      "Sample Bank",
      "Only Card",
      "Sample Savings",
    ]);
  });
});

describe("accountLabel", () => {
  it("takes the name and kind from the one preset importing into the account", () => {
    expect(accountLabel("Only Card", "Liability", presets)).toEqual({
      name: "Only Card Statement",
      kind: "card",
    });
    expect(accountLabel("Sample Savings", "Asset", presets)).toEqual({
      name: "Sample Savings Statement",
      kind: "bank",
    });
  });

  it("keeps the account's own name when no single preset names it", () => {
    expect(accountLabel("Sample Bank", "Asset", presets)).toEqual({
      name: "Sample Bank",
      kind: "card",
    });
    expect(accountLabel("No Preset Bank 050505", "Asset", [])).toEqual({
      name: "No Preset Bank 050505",
      kind: "bank",
    });
  });

  it("reads a Liability without a card preset as a card", () => {
    expect(accountLabel("Sample Loan", "Liability", presets)).toEqual({
      name: "Sample Loan",
      kind: "card",
    });
  });

  it("reads an account the ledger doesn't have as a bank unless a preset says card", () => {
    expect(accountLabel("Sample Savings", null, presets)).toEqual({
      name: "Sample Savings Statement",
      kind: "bank",
    });
    expect(accountLabel("Only Card", null, presets)).toEqual({
      name: "Only Card Statement",
      kind: "card",
    });
  });
});

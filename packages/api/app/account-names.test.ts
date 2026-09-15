import { describe, expect, it } from "vitest";
import { accountLabel, importablePaths } from "./account-names.js";

const presets = [
  {
    name: "Bank PDF",
    base_account: "assets:bank:sample",
    custom_mappings_filenames: [],
  },
  {
    name: "Bank XLS",
    base_account: "assets:bank:sample",
    custom_mappings_filenames: [],
    is_credit_card: true,
  },
  {
    name: "Only Card",
    base_account: "liabilities:cards:only-card",
    custom_mappings_filenames: [],
    is_credit_card: true,
  },
  {
    name: "Sample Savings",
    base_account: "assets:bank:sample-savings",
    custom_mappings_filenames: [],
  },
];

describe("importablePaths", () => {
  it("keeps one path per base account, in first-seen order", () => {
    expect(importablePaths(presets)).toEqual([
      "assets:bank:sample",
      "liabilities:cards:only-card",
      "assets:bank:sample-savings",
    ]);
  });
});

describe("accountLabel", () => {
  it("takes the name and kind from the one preset importing into the account", () => {
    expect(
      accountLabel("liabilities:cards:only-card", "Liability", presets),
    ).toEqual({ name: "Only Card", kind: "card" });
    expect(
      accountLabel("assets:bank:sample-savings", "Asset", presets),
    ).toEqual({ name: "Sample Savings", kind: "bank" });
  });

  it("falls back to the readable last segment when no single preset names it", () => {
    expect(accountLabel("assets:bank:sample", "Asset", presets)).toEqual({
      name: "Sample",
      kind: "card",
    });
    expect(accountLabel("assets:bank:no-preset_050505", "Asset", [])).toEqual({
      name: "No preset 050505",
      kind: "bank",
    });
  });

  it("reads a Liability without a card preset as a card", () => {
    expect(
      accountLabel("liabilities:loans:sample-loan", "Liability", presets),
    ).toEqual({ name: "Sample loan", kind: "card" });
  });

  it("reads an account the ledger doesn't have as a bank unless a preset says card", () => {
    expect(accountLabel("assets:bank:sample-savings", null, presets)).toEqual({
      name: "Sample Savings",
      kind: "bank",
    });
    expect(accountLabel("liabilities:cards:only-card", null, presets)).toEqual({
      name: "Only Card",
      kind: "card",
    });
  });
});

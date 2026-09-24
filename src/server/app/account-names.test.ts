import { describe, expect, it } from "vitest";
import type { ImportInstitution } from "../../shared/index.js";
import { accountLabel, importableAccounts } from "./account-names.js";

const account = (id: number, name: string, isCreditCard = false) => ({
  account_id: id,
  name,
  is_credit_card: isCreditCard,
  account_identifiers: [],
  custom_mappings_filenames: [],
});

const institutions: ImportInstitution[] = [
  {
    id: 1,
    name: "Sample Bank",
    parsers: ["sample-bank-xls"],
    accounts: [account(11, "Sample Savings Statement")],
  },
  {
    id: 2,
    name: "Sample Cards",
    parsers: ["sample-cc-xls"],
    accounts: [account(21, "Only Card Statement", true)],
  },
];

describe("importableAccounts", () => {
  it("lists every preset account, in table order", () => {
    expect(
      importableAccounts(institutions).map((one) => one.account_id),
    ).toEqual([11, 21]);
  });
});

describe("accountLabel", () => {
  it("takes the name and kind from the preset account with the same id", () => {
    expect(
      accountLabel(
        { id: 21, name: "Only Card", account_type: "Liability" },
        institutions,
      ),
    ).toEqual({ name: "Only Card Statement", kind: "card" });
    expect(
      accountLabel(
        { id: 11, name: "Sample Savings", account_type: "Asset" },
        institutions,
      ),
    ).toEqual({ name: "Sample Savings Statement", kind: "bank" });
  });

  it("says a preset account is a card or not whatever the ledger type", () => {
    expect(
      accountLabel(
        { id: 21, name: "Only Card", account_type: "Asset" },
        institutions,
      ),
    ).toEqual({ name: "Only Card Statement", kind: "card" });
  });

  it("keeps an account's own name when no preset lists it, whatever its name", () => {
    expect(
      accountLabel(
        { id: 99, name: "Sample Savings Statement", account_type: "Asset" },
        institutions,
      ),
    ).toEqual({ name: "Sample Savings Statement", kind: "bank" });
    expect(
      accountLabel(
        { id: 98, name: "No Preset Bank 050505", account_type: "Asset" },
        [],
      ),
    ).toEqual({ name: "No Preset Bank 050505", kind: "bank" });
  });

  it("reads a Liability no preset lists as a card", () => {
    expect(
      accountLabel(
        { id: 97, name: "Sample Loan", account_type: "Liability" },
        institutions,
      ),
    ).toEqual({ name: "Sample Loan", kind: "card" });
  });
});

import { describe, expect, it } from "vitest";
import type { PresetAccount } from "../categorization/CategorizationInstructions";
import { fileUsers, otherUsers, sameNotes } from "./file-users";

function presetAccount(
  account_id: number,
  name: string,
  files: string[],
): PresetAccount {
  return {
    institution: "Sample Bank",
    account: {
      account_id,
      name,
      is_credit_card: false,
      account_identifiers: [],
      custom_mappings_filenames: files,
      ledger_account_name: name,
    },
  };
}

describe("fileUsers", () => {
  const accounts = [
    presetAccount(1, "Sample Savings", ["custom_mappings_default.prompt"]),
    presetAccount(2, "Sample Card", [
      "custom_mappings_default.prompt",
      "custom_mappings_card.prompt",
    ]),
  ];
  const users = fileUsers(accounts);

  it("names the other accounts listing a file", () => {
    expect(
      otherUsers(users, "custom_mappings_default.prompt", 1).map(
        (one) => one.account.name,
      ),
    ).toEqual(["Sample Card"]);
  });

  it("names none for a file only one account lists", () => {
    expect(otherUsers(users, "custom_mappings_card.prompt", 2)).toEqual([]);
  });
});

describe("sameNotes", () => {
  const accounts = [
    presetAccount(1, "Sample Savings", ["custom_mappings_default.prompt"]),
    presetAccount(2, "Sample Card", ["custom_mappings_default.prompt"]),
    presetAccount(3, "Sample Current", [
      "custom_mappings_default.prompt",
      "custom_mappings_card.prompt",
    ]),
    presetAccount(4, "Sample Wallet", []),
    presetAccount(5, "Sample Cash", []),
  ];
  const [savings, , current, wallet] = accounts;
  const names = (list: PresetAccount[]) => list.map((one) => one.account.name);

  it("names the accounts listing the same files in the same order", () => {
    expect(names(sameNotes(accounts, savings!))).toEqual(["Sample Card"]);
    expect(names(sameNotes(accounts, current!))).toEqual([]);
  });

  it("names none for an account without notes", () => {
    expect(sameNotes(accounts, wallet!)).toEqual([]);
  });
});

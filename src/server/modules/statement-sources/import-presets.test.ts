import { describe, expect, it } from "vitest";
import {
  importAccountSchema,
  type ImportAccount,
  type ImportInstitution,
} from "../../../shared/index.js";
import { resolveImportAccount } from "./import-presets.js";

const BANK_PARSER = "hdfc-bank-xls";
const CARD_PARSER = "hdfc-cc-xls";

function statement(parserName: string, identifier: string | null) {
  return { file: "statement.xls", parserName, identifier };
}

function account(
  overrides: Partial<ImportAccount> & { account_id: number; name: string },
): ImportAccount {
  return {
    is_credit_card: false,
    account_identifiers: [],
    custom_mappings_filenames: [],
    ...overrides,
  };
}

const bankInstitution: ImportInstitution = {
  id: 1,
  name: "Sample Bank",
  parsers: [BANK_PARSER],
  accounts: [account({ account_id: 11, name: "Sample Savings" })],
};
const cardA = account({
  account_id: 21,
  name: "Sample Card A",
  is_credit_card: true,
  account_identifiers: ["050505XXXXXX0505"],
});
const cardB = account({
  account_id: 22,
  name: "Sample Card B",
  is_credit_card: true,
  account_identifiers: ["050505XXXXXX0506", "0505050000000506"],
});
const cardsInstitution: ImportInstitution = {
  id: 2,
  name: "Sample Cards",
  parsers: [CARD_PARSER],
  accounts: [cardA, cardB],
};
const emptyInstitution: ImportInstitution = {
  id: 3,
  name: "Sample Empty",
  parsers: ["sample-empty-pdf"],
  accounts: [],
};
const institutions = [bankInstitution, cardsInstitution, emptyInstitution];

describe("resolveImportAccount", () => {
  it("rejects a parser no institution lists", () => {
    expect(
      resolveImportAccount(institutions, statement("other", null)),
    ).toMatchObject({
      ok: false,
      reason: "no_institution_for_parser",
      institutionName: null,
      candidateAccountNames: [],
      parserName: "other",
    });
  });

  it("rejects an institution with no accounts", () => {
    expect(
      resolveImportAccount(institutions, statement("sample-empty-pdf", null)),
    ).toMatchObject({
      ok: false,
      reason: "institution_has_no_accounts",
      institutionName: "Sample Empty",
    });
  });

  it("gives every statement to a lone account without identifiers", () => {
    for (const identifier of [null, "05050505050505"]) {
      expect(
        resolveImportAccount(institutions, statement(BANK_PARSER, identifier)),
      ).toEqual({
        ok: true,
        institution: bankInstitution,
        account: bankInstitution.accounts[0],
      });
    }
  });

  it("checks a lone account's identifiers", () => {
    const one: ImportInstitution = { ...cardsInstitution, accounts: [cardB] };
    expect(
      resolveImportAccount([one], statement(CARD_PARSER, "0505050000000506")),
    ).toMatchObject({ ok: true, account: cardB });
    expect(
      resolveImportAccount([one], statement(CARD_PARSER, null)),
    ).toMatchObject({
      ok: false,
      reason: "statement_account_identifier_required",
      candidateAccountNames: ["Sample Card B"],
    });
    expect(
      resolveImportAccount([one], statement(CARD_PARSER, "050505XXXXXX0599")),
    ).toMatchObject({
      ok: false,
      reason: "statement_account_identifier_mismatch",
      identifier: "050505XXXXXX0599",
    });
  });

  it("picks the one account of several that lists the identifier", () => {
    expect(
      resolveImportAccount(
        institutions,
        statement(CARD_PARSER, "050505XXXXXX0506"),
      ),
    ).toEqual({ ok: true, institution: cardsInstitution, account: cardB });
    expect(
      resolveImportAccount(institutions, statement(CARD_PARSER, null)),
    ).toMatchObject({
      ok: false,
      reason: "statement_account_identifier_required",
      institutionName: "Sample Cards",
      candidateAccountNames: ["Sample Card A", "Sample Card B"],
    });
    expect(
      resolveImportAccount(
        institutions,
        statement(CARD_PARSER, "050505XXXXXX0599"),
      ),
    ).toMatchObject({
      ok: false,
      reason: "statement_account_identifier_mismatch",
      candidateAccountNames: ["Sample Card A", "Sample Card B"],
    });
  });
});

describe("importAccountSchema", () => {
  it("accepts only canonical statement account identifiers", () => {
    const base = {
      account_id: 21,
      name: "Sample Card",
      is_credit_card: true,
      custom_mappings_filenames: [],
    };
    expect(
      importAccountSchema.parse({
        ...base,
        account_identifiers: ["050505XXXXXX0505"],
      }).account_identifiers,
    ).toEqual(["050505XXXXXX0505"]);
    for (const bad of ["0505 05XX XXXX 0505", "050505xxxxxx0505", ""]) {
      expect(() =>
        importAccountSchema.parse({ ...base, account_identifiers: [bad] }),
      ).toThrow();
    }
  });
});

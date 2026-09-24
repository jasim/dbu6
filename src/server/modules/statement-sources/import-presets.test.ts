import { describe, expect, it } from "vitest";
import {
  importPresetSchema,
  type ImportAccount,
  type ImportInstitution,
  type ImportPreset,
} from "../../../shared/index.js";
import { resolveImportAccount, resolveImportPreset } from "./import-presets.js";

const BANK_PARSER = "hdfc-bank-xls";
const CARD_PARSER = "hdfc-cc-xls";

function preset(
  overrides: Partial<ImportPreset> & { name: string },
): ImportPreset {
  return {
    base_account: `Sample ${overrides.name}`,
    custom_mappings_filenames: [],
    ...overrides,
  };
}

const bank = preset({
  name: "Bank",
  custom_statement_parser_path: BANK_PARSER,
});
const primaryCard = preset({
  name: "Card A",
  base_account: "Sample Card A",
  is_credit_card: true,
  custom_statement_parser_path: CARD_PARSER,
  statement_account_identifier: "050505XXXXXX0505",
});
const secondCard = preset({
  name: "Card B",
  base_account: "Sample Card B",
  is_credit_card: true,
  custom_statement_parser_path: CARD_PARSER,
  statement_account_identifier: "050505XXXXXX0506",
});
const parserless = preset({ name: "No parser" });

function statement(parserName: string, identifier: string | null) {
  return { file: "statement.xls", parserName, identifier };
}

describe("resolveImportPreset", () => {
  it("matches the only preset using a parser when it carries no identifier", () => {
    const presets = [parserless, bank, primaryCard];
    expect(resolveImportPreset(presets, statement(BANK_PARSER, null))).toEqual({
      ok: true,
      preset: bank,
    });
    // An emitted identifier is not checked when the preset does not declare one.
    expect(
      resolveImportPreset(presets, statement(BANK_PARSER, "05050505050505")),
    ).toEqual({ ok: true, preset: bank });
  });

  it("rejects a parser no preset declares", () => {
    const result = resolveImportPreset([bank], statement("other", null));
    expect(result).toMatchObject({
      ok: false,
      reason: "no_preset_for_parser",
      file: "statement.xls",
      parserName: "other",
      identifier: null,
      candidatePresetNames: [],
    });
  });

  it("requires the emitted identifier to equal a lone preset's identifier", () => {
    const presets = [bank, primaryCard];
    expect(
      resolveImportPreset(presets, statement(CARD_PARSER, "050505XXXXXX0505")),
    ).toEqual({ ok: true, preset: primaryCard });

    expect(
      resolveImportPreset(presets, statement(CARD_PARSER, "050505XXXXXX0506")),
    ).toMatchObject({
      ok: false,
      reason: "statement_account_identifier_mismatch",
      identifier: "050505XXXXXX0506",
      candidatePresetNames: ["Card A"],
    });

    expect(
      resolveImportPreset(presets, statement(CARD_PARSER, null)),
    ).toMatchObject({
      ok: false,
      reason: "statement_account_identifier_required",
      parserName: CARD_PARSER,
      identifier: null,
    });
  });

  it("disambiguates presets sharing a parser by identifier", () => {
    const presets = [bank, primaryCard, secondCard];
    expect(
      resolveImportPreset(presets, statement(CARD_PARSER, "050505XXXXXX0506")),
    ).toEqual({ ok: true, preset: secondCard });

    expect(
      resolveImportPreset(presets, statement(CARD_PARSER, null)),
    ).toMatchObject({
      ok: false,
      reason: "statement_account_identifier_required",
      candidatePresetNames: ["Card A", "Card B"],
    });

    expect(
      resolveImportPreset(presets, statement(CARD_PARSER, "050505XXXXXX0599")),
    ).toMatchObject({
      ok: false,
      reason: "statement_account_identifier_mismatch",
      identifier: "050505XXXXXX0599",
      candidatePresetNames: ["Card A", "Card B"],
    });
  });

  it("rejects when several presets sharing a parser carry the same identifier", () => {
    const duplicate = preset({
      ...secondCard,
      name: "Card B copy",
      statement_account_identifier: primaryCard.statement_account_identifier,
    });
    const result = resolveImportPreset(
      [primaryCard, secondCard, duplicate],
      statement(CARD_PARSER, "050505XXXXXX0505"),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "statement_account_identifier_mismatch",
    });
    expect((result as { message: string }).message).toContain("Card B copy");
  });

  it("cannot match a preset without an identifier when the parser is shared", () => {
    const unlabeled = preset({
      name: "Card C",
      base_account: "Sample Card C",
      custom_statement_parser_path: CARD_PARSER,
    });
    expect(
      resolveImportPreset(
        [primaryCard, unlabeled],
        statement(CARD_PARSER, "050505XXXXXX0599"),
      ),
    ).toMatchObject({
      ok: false,
      reason: "statement_account_identifier_mismatch",
    });
  });
});

describe("importPresetSchema", () => {
  it("accepts only a canonical statement account identifier", () => {
    const base = {
      name: "HDFC CC XLS",
      base_account: "HDFC Credit Card",
      custom_mappings_filenames: [],
      is_credit_card: true,
      custom_statement_parser_path: CARD_PARSER,
    };
    expect(
      importPresetSchema.parse({
        ...base,
        statement_account_identifier: "050505XXXXXX0505",
      }).statement_account_identifier,
    ).toBe("050505XXXXXX0505");
    for (const bad of ["0505 05XX XXXX 0505", "050505xxxxxx0505", ""]) {
      expect(() =>
        importPresetSchema.parse({
          ...base,
          statement_account_identifier: bad,
        }),
      ).toThrow();
    }
  });
});

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

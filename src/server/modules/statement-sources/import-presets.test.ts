import { describe, expect, it } from "vitest";
import { importPresetSchema, type ImportPreset } from "../../../shared/index.js";
import { resolveImportPreset } from "./import-presets.js";

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

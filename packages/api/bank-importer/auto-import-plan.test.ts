import { describe, expect, it } from "vitest";
import type { ImportPreset, StatementAccount } from "dbu6-shared";
import { unsafeAsChrono } from "../modules/values/index.js";
import type { AbacusStatement } from "../modules/statement/index.js";
import {
  planAutoImport,
  type AutoImportPlan,
  type FileRecognition,
} from "./auto-import-plan.js";

const BANK_PARSER = "custom-built-parsers/hdfc-bank-xls/parser.py";
const CARD_PARSER = "custom-built-parsers/hdfc-cc-xls/parser.py";

function preset(
  overrides: Partial<ImportPreset> & { name: string },
): ImportPreset {
  return {
    base_account: `assets:bank:${overrides.name.toLowerCase()}`,
    custom_mappings_filenames: [],
    ...overrides,
  };
}

const bank = preset({
  name: "Bank",
  custom_statement_parser_path: BANK_PARSER,
});
const cardA = preset({
  name: "Card A",
  base_account: "cc:sample-a",
  is_credit_card: true,
  custom_statement_parser_path: CARD_PARSER,
  statement_account_identifier: "050505XXXXXX0505",
});
const cardB = preset({
  name: "Card B",
  base_account: "cc:sample-b",
  is_credit_card: true,
  custom_statement_parser_path: CARD_PARSER,
  statement_account_identifier: "050505XXXXXX0506",
});

function statement(
  account: StatementAccount | null,
  institution: string | null = null,
): AbacusStatement {
  return {
    transactions: unsafeAsChrono([]),
    opening: null,
    closing: null,
    account,
    institution,
  };
}

function recognized(
  file: string,
  parserPath: string,
  account: StatementAccount | null,
  institution: string | null = null,
): FileRecognition {
  return {
    outcome: "recognized",
    file,
    parserPath,
    statement: statement(account, institution),
  };
}

const bankAccount = { kind: "bank", identifier: "05050505050505" } as const;
const cardAccountA = { kind: "card", identifier: "050505XXXXXX0505" } as const;
const cardAccountB = { kind: "card", identifier: "050505XXXXXX0506" } as const;

function groupNames(plan: AutoImportPlan) {
  if (!plan.ok) throw new Error("expected an importable plan");
  return plan.groups.map((group) => [
    group.preset.name,
    group.statements.map((one) => one.file),
  ]);
}

describe("planAutoImport", () => {
  it("groups files by the preset they resolve to, one group per account", () => {
    const plan = planAutoImport(
      [
        recognized("bank-jan.xls", BANK_PARSER, bankAccount),
        recognized("card-jan.xls", CARD_PARSER, cardAccountA),
        recognized("bank-feb.xls", BANK_PARSER, bankAccount),
        recognized("card-other.xls", CARD_PARSER, cardAccountB),
      ],
      [bank, cardA, cardB],
    );

    expect(groupNames(plan)).toEqual([
      ["Bank", ["bank-jan.xls", "bank-feb.xls"]],
      ["Card A", ["card-jan.xls"]],
      ["Card B", ["card-other.xls"]],
    ]);
  });

  it("reports the parser, account, and institution behind every resolved file", () => {
    const plan = planAutoImport(
      [
        recognized(
          "card-jan.xls",
          CARD_PARSER,
          cardAccountA,
          "NOPII Bank Cards Division",
        ),
      ],
      [cardA],
    );

    expect(plan.files).toEqual([
      {
        status: "resolved",
        file: "card-jan.xls",
        presetName: "Card A",
        parserPath: CARD_PARSER,
        account: cardAccountA,
        institution: "NOPII Bank Cards Division",
      },
    ]);
  });

  it("carries a statement that reports no account into its lone preset", () => {
    const plan = planAutoImport(
      [recognized("bank-jan.xls", BANK_PARSER, null)],
      [bank],
    );

    expect(groupNames(plan)).toEqual([["Bank", ["bank-jan.xls"]]]);
    expect(plan.files[0]).toMatchObject({ account: null, presetName: "Bank" });
  });

  it("rejects the whole batch when one file is unrecognized, and still plans the rest", () => {
    const plan = planAutoImport(
      [
        recognized("bank-jan.xls", BANK_PARSER, bankAccount),
        {
          outcome: "unrecognized",
          file: "holiday-photos.csv",
          candidateParserPaths: [CARD_PARSER],
        },
      ],
      [bank, cardA],
    );

    expect(plan.ok).toBe(false);
    expect(plan.files).toEqual([
      {
        status: "resolved",
        file: "bank-jan.xls",
        presetName: "Bank",
        parserPath: BANK_PARSER,
        account: bankAccount,
        institution: null,
      },
      {
        status: "unrecognized",
        file: "holiday-photos.csv",
        candidateParserPaths: [CARD_PARSER],
      },
    ]);
  });

  it("rejects the batch when a file matched several parsers", () => {
    const plan = planAutoImport(
      [
        {
          outcome: "ambiguous",
          file: "statement.xls",
          matchingParserPaths: [BANK_PARSER, CARD_PARSER],
        },
      ],
      [bank, cardA],
    );

    expect(plan).toEqual({
      ok: false,
      files: [
        {
          status: "ambiguous",
          file: "statement.xls",
          matchingParserPaths: [BANK_PARSER, CARD_PARSER],
        },
      ],
    });
  });

  it("rejects the batch with the resolver's reason when no preset claims a file", () => {
    const plan = planAutoImport(
      [recognized("card-jan.xls", CARD_PARSER, cardAccountA)],
      [bank],
    );

    expect(plan.ok).toBe(false);
    expect(plan.files[0]).toMatchObject({
      status: "unresolved",
      file: "card-jan.xls",
      reason: "no_preset_for_parser",
      parserPath: CARD_PARSER,
      account: cardAccountA,
      candidatePresetNames: [],
    });
    expect((plan.files[0] as { message: string }).message).toContain(
      "card-jan.xls",
    );
  });

  it("rejects a file whose identifier none of the presets sharing its parser carry", () => {
    const plan = planAutoImport(
      [
        recognized("card-third.xls", CARD_PARSER, {
          kind: "card",
          identifier: "050505XXXXXX0599",
        }),
      ],
      [cardA, cardB],
    );

    expect(plan.ok).toBe(false);
    expect(plan.files[0]).toMatchObject({
      status: "unresolved",
      reason: "statement_account_identifier_mismatch",
      candidatePresetNames: ["Card A", "Card B"],
    });
  });

  it("plans nothing for an empty batch", () => {
    expect(planAutoImport([], [bank])).toEqual({
      ok: true,
      files: [],
      groups: [],
    });
  });

  it("keeps presets with the same name apart", () => {
    const twin = preset({
      name: "Card A",
      base_account: "cc:sample-twin",
      is_credit_card: true,
      custom_statement_parser_path: CARD_PARSER,
      statement_account_identifier: "050505XXXXXX0506",
    });
    const plan = planAutoImport(
      [
        recognized("card-jan.xls", CARD_PARSER, cardAccountA),
        recognized("twin-jan.xls", CARD_PARSER, cardAccountB),
      ],
      [cardA, twin],
    );

    if (!plan.ok) throw new Error("expected an importable plan");
    expect(plan.groups.map((group) => group.preset.base_account)).toEqual([
      "cc:sample-a",
      "cc:sample-twin",
    ]);
  });
});

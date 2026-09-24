import { describe, expect, it } from "vitest";
import type {
  ImportAccount,
  ImportInstitution,
  StatementAccount,
} from "../../../shared/index.js";
import { unsafeAsChrono } from "../values/index.js";
import type { AbacusStatement } from "../statement/index.js";
import {
  planAutoImport,
  type AutoImportPlan,
  type FileRecognition,
} from "./auto-import-plan.js";

const BANK_PARSER = "hdfc-bank-xls";
const CARD_PARSER = "hdfc-cc-xls";

const BANK_PDF_PARSER = "hdfc-bank-pdf";

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

const bankAccountPreset = account({ account_id: 11, name: "Bank" });
const bank: ImportInstitution = {
  id: 1,
  name: "Sample Bank",
  parsers: [BANK_PARSER, BANK_PDF_PARSER],
  accounts: [bankAccountPreset],
};
const cardA = account({
  account_id: 21,
  name: "Card A",
  is_credit_card: true,
  account_identifiers: ["050505XXXXXX0505"],
});
const cardB = account({
  account_id: 22,
  name: "Card B",
  is_credit_card: true,
  account_identifiers: ["050505XXXXXX0506"],
});
const cards: ImportInstitution = {
  id: 2,
  name: "Sample Cards",
  parsers: [CARD_PARSER],
  accounts: [cardA, cardB],
};
const cardAOnly: ImportInstitution = { ...cards, accounts: [cardA] };

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
  parserName: string,
  account: StatementAccount | null,
  institution: string | null = null,
): FileRecognition {
  return {
    outcome: "recognized",
    file,
    parserName,
    statement: statement(account, institution),
  };
}

const bankAccount = { kind: "bank", identifier: "05050505050505" } as const;
const cardAccountA = { kind: "card", identifier: "050505XXXXXX0505" } as const;
const cardAccountB = { kind: "card", identifier: "050505XXXXXX0506" } as const;

function groupNames(plan: AutoImportPlan) {
  if (!plan.ok) throw new Error("expected an importable plan");
  return plan.groups.map((group) => [
    group.account.name,
    group.statements.map((one) => one.file),
  ]);
}

describe("planAutoImport", () => {
  it("groups files by the account they resolve to", () => {
    const plan = planAutoImport(
      [
        recognized("bank-jan.xls", BANK_PARSER, bankAccount),
        recognized("card-jan.xls", CARD_PARSER, cardAccountA),
        recognized("bank-feb.xls", BANK_PARSER, bankAccount),
        recognized("card-other.xls", CARD_PARSER, cardAccountB),
      ],
      [bank, cards],
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
      [cardAOnly],
    );

    expect(plan.files).toEqual([
      {
        status: "resolved",
        file: "card-jan.xls",
        accountId: 21,
        accountName: "Card A",
        parserName: CARD_PARSER,
        account: cardAccountA,
        institution: "NOPII Bank Cards Division",
      },
    ]);
  });

  it("carries a statement that reports no account into its lone account", () => {
    const plan = planAutoImport(
      [recognized("bank-jan.xls", BANK_PARSER, null)],
      [bank],
    );

    expect(groupNames(plan)).toEqual([["Bank", ["bank-jan.xls"]]]);
    expect(plan.files[0]).toMatchObject({ account: null, accountName: "Bank" });
  });

  it("rejects the whole batch when one file is unrecognized, and still plans the rest", () => {
    const plan = planAutoImport(
      [
        recognized("bank-jan.xls", BANK_PARSER, bankAccount),
        {
          outcome: "unrecognized",
          file: "holiday-photos.csv",
          candidateParserNames: [CARD_PARSER],
        },
      ],
      [bank, cardAOnly],
    );

    expect(plan.ok).toBe(false);
    expect(plan.files).toEqual([
      {
        status: "resolved",
        file: "bank-jan.xls",
        accountId: 11,
        accountName: "Bank",
        parserName: BANK_PARSER,
        account: bankAccount,
        institution: null,
      },
      {
        status: "unrecognized",
        file: "holiday-photos.csv",
        candidateParserNames: [CARD_PARSER],
      },
    ]);
  });

  it("rejects the batch when a file matched several parsers", () => {
    const plan = planAutoImport(
      [
        {
          outcome: "ambiguous",
          file: "statement.xls",
          matchingParserNames: [BANK_PARSER, CARD_PARSER],
        },
      ],
      [bank, cardAOnly],
    );

    expect(plan).toEqual({
      ok: false,
      files: [
        {
          status: "ambiguous",
          file: "statement.xls",
          matchingParserNames: [BANK_PARSER, CARD_PARSER],
        },
      ],
    });
  });

  it("rejects the batch with the resolver's reason when no institution lists the parser", () => {
    const plan = planAutoImport(
      [recognized("card-jan.xls", CARD_PARSER, cardAccountA)],
      [bank],
    );

    expect(plan.ok).toBe(false);
    expect(plan.files[0]).toMatchObject({
      status: "unresolved",
      file: "card-jan.xls",
      reason: "no_institution_for_parser",
      parserName: CARD_PARSER,
      account: cardAccountA,
      institutionName: null,
      candidateAccountNames: [],
    });
    expect((plan.files[0] as { message: string }).message).toContain(
      "card-jan.xls",
    );
  });

  it("rejects a file whose identifier none of the institution's accounts list", () => {
    const plan = planAutoImport(
      [
        recognized("card-third.xls", CARD_PARSER, {
          kind: "card",
          identifier: "050505XXXXXX0599",
        }),
      ],
      [cards],
    );

    expect(plan.ok).toBe(false);
    expect(plan.files[0]).toMatchObject({
      status: "unresolved",
      reason: "statement_account_identifier_mismatch",
      institutionName: "Sample Cards",
      candidateAccountNames: ["Card A", "Card B"],
    });
  });

  it("plans nothing for an empty batch", () => {
    expect(planAutoImport([], [bank])).toEqual({
      ok: true,
      files: [],
      groups: [],
    });
  });

  it("puts one account's statements from two parsers in one group", () => {
    const plan = planAutoImport(
      [
        recognized("bank-jan.xls", BANK_PARSER, bankAccount),
        recognized("bank-feb.pdf", BANK_PDF_PARSER, bankAccount),
      ],
      [bank],
    );

    if (!plan.ok) throw new Error("expected an importable plan");
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({
      institution: { name: "Sample Bank" },
      account: { account_id: 11 },
    });
    expect(plan.groups[0].statements.map((one) => one.parserName)).toEqual([
      BANK_PARSER,
      BANK_PDF_PARSER,
    ]);
  });
});

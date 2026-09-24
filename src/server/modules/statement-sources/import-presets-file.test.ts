import { describe, expect, it } from "vitest";
import {
  convertImportPresetsFile,
  groupIntoInstitutions,
  type ImportPreset,
} from "./import-presets-file.js";

function preset(
  overrides: Partial<ImportPreset> & { name: string; base_account: string },
): ImportPreset {
  return { custom_mappings_filenames: [], ...overrides };
}

const accountIds = new Map([
  ["Sample Savings", 11],
  ["Sample Current", 12],
  ["Sample Card A", 21],
  ["Sample Card B", 22],
  ["Sample Wallet", 31],
]);

const savingsXls = preset({
  name: "Sample Savings XLS",
  base_account: "Sample Savings",
  custom_statement_parser_path: "sample-bank-xls",
  custom_mappings_filenames: ["custom_mappings_default.prompt"],
});
const savingsPdf = preset({
  name: "Sample Savings PDF",
  base_account: "Sample Savings",
  custom_statement_parser_path: "sample-bank-pdf",
  statement_account_identifier: "0505050000000011",
  custom_mappings_filenames: [
    "custom_mappings_personal.prompt",
    "custom_mappings_default.prompt",
  ],
});
const currentPdf = preset({
  name: "Sample Current PDF",
  base_account: "Sample Current",
  custom_statement_parser_path: "sample-bank-pdf",
  statement_account_identifier: "0505050000000012",
});
const cardA = preset({
  name: "Sample Card A",
  base_account: "Sample Card A",
  is_credit_card: true,
  custom_statement_parser_path: "sample-cc-xls",
  statement_account_identifier: "050505XXXXXX0505",
});
const cardB = preset({
  name: "Sample Card B",
  base_account: "Sample Card B",
  is_credit_card: true,
  custom_statement_parser_path: "sample-cc-xls",
  statement_account_identifier: "050505XXXXXX0506",
});
const wallet = preset({ name: "Sample Wallet", base_account: "Sample Wallet" });

describe("groupIntoInstitutions", () => {
  it("joins presets that share a parser or an account, through others too", () => {
    expect(
      groupIntoInstitutions([
        savingsXls,
        cardA,
        wallet,
        currentPdf,
        cardB,
        savingsPdf,
      ]).map((group) => group.map((one) => one.name)),
    ).toEqual([
      // savingsXls and savingsPdf share an account; savingsPdf and
      // currentPdf a parser.
      ["Sample Savings XLS", "Sample Current PDF", "Sample Savings PDF"],
      ["Sample Card A", "Sample Card B"],
      ["Sample Wallet"],
    ]);
  });
});

describe("convertImportPresetsFile", () => {
  it("merges an account's presets and names each institution after its first", () => {
    const conversion = convertImportPresetsFile(
      [savingsXls, savingsPdf, currentPdf, cardA, cardB, wallet],
      accountIds,
    );
    expect(conversion).toEqual({
      ok: true,
      institutions: [
        {
          id: null,
          name: "Sample Savings XLS",
          parsers: ["sample-bank-xls", "sample-bank-pdf"],
          accounts: [
            {
              account_id: 11,
              name: "Sample Savings XLS",
              is_credit_card: false,
              account_identifiers: ["0505050000000011"],
              custom_mappings_filenames: [
                "custom_mappings_default.prompt",
                "custom_mappings_personal.prompt",
              ],
            },
            {
              account_id: 12,
              name: "Sample Current PDF",
              is_credit_card: false,
              account_identifiers: ["0505050000000012"],
              custom_mappings_filenames: [],
            },
          ],
        },
        {
          id: null,
          name: "Sample Card A",
          parsers: ["sample-cc-xls"],
          accounts: [
            {
              account_id: 21,
              name: "Sample Card A",
              is_credit_card: true,
              account_identifiers: ["050505XXXXXX0505"],
              custom_mappings_filenames: [],
            },
            {
              account_id: 22,
              name: "Sample Card B",
              is_credit_card: true,
              account_identifiers: ["050505XXXXXX0506"],
              custom_mappings_filenames: [],
            },
          ],
        },
        // A preset without a parser is an institution without parsers.
        {
          id: null,
          name: "Sample Wallet",
          parsers: [],
          accounts: [
            {
              account_id: 31,
              name: "Sample Wallet",
              is_credit_card: false,
              account_identifiers: [],
              custom_mappings_filenames: [],
            },
          ],
        },
      ],
      warnings: [
        expect.stringContaining(
          'The presets for "Sample Savings" ("Sample Savings XLS", "Sample Savings PDF") listed different instruction files',
        ),
      ],
    });
  });

  it("names every base_account the ledger lacks", () => {
    expect(
      convertImportPresetsFile(
        [
          preset({ name: "One", base_account: "Sample Missing" }),
          savingsXls,
          preset({ name: "Two", base_account: "Sample Gone" }),
          preset({ name: "Three", base_account: "Sample Missing" }),
        ],
        accountIds,
      ),
    ).toMatchObject({
      ok: false,
      code: "unresolved_base_accounts",
      names: ["Sample Missing", "Sample Gone"],
    });
  });

  it("refuses an account whose presets disagree on is_credit_card", () => {
    expect(
      convertImportPresetsFile(
        [cardA, { ...cardA, name: "Sample Card A CSV", is_credit_card: false }],
        accountIds,
      ),
    ).toMatchObject({
      ok: false,
      code: "conflicting_is_credit_card",
      names: ["Sample Card A"],
    });
  });
});

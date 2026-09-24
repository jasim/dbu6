import { describe, expect, it } from "vitest";
import {
  importPresetChangeSchema,
  type ImportAccount,
  type ImportPresetChange,
} from "../../../shared/index.js";
import {
  applyImportPresetChanges,
  presetAdditions,
  validateImportPresets,
  type PresetInstitution,
} from "./import-preset-changes.js";

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

function institution(
  overrides: Partial<PresetInstitution> & { name: string },
): PresetInstitution {
  return { id: null, parsers: [], accounts: [], ...overrides };
}

const bank = institution({
  id: 1,
  name: "Sample Bank",
  parsers: ["sample-bank-xls", "sample-bank-pdf"],
  accounts: [
    account({
      account_id: 11,
      name: "Sample Savings",
      custom_mappings_filenames: [
        "custom_mappings_default.prompt",
        "custom_mappings_personal.prompt",
      ],
    }),
  ],
});
const cards = institution({
  id: 2,
  name: "Sample Cards",
  parsers: ["sample-cc-xls"],
  accounts: [
    account({
      account_id: 21,
      name: "Sample Card A",
      is_credit_card: true,
      account_identifiers: ["050505XXXXXX0505"],
    }),
    account({
      account_id: 22,
      name: "Sample Card B",
      is_credit_card: true,
      account_identifiers: ["050505XXXXXX0506"],
    }),
  ],
});
const table = [bank, cards];

function applied(
  changes: ImportPresetChange[],
  from: readonly PresetInstitution[] = table,
) {
  const result = applyImportPresetChanges(from, changes);
  if (!result.ok) throw new Error(result.problem.message);
  return result.institutions;
}

function refusal(
  changes: ImportPresetChange[],
  from: readonly PresetInstitution[] = table,
) {
  const result = applyImportPresetChanges(from, changes);
  if (result.ok) throw new Error("expected the batch to be refused");
  return result.problem;
}

function codes(institutions: readonly PresetInstitution[]) {
  return validateImportPresets(institutions).map((problem) => problem.code);
}

describe("applyImportPresetChanges", () => {
  it("applies a batch in order without touching its input", () => {
    const before = structuredClone(table);
    const after = applied([
      { kind: "add_institution", name: "Sample Wallet", parsers: [] },
      {
        kind: "add_parser",
        institution: "Sample Wallet",
        parser: "sample-wallet-csv",
      },
      {
        kind: "add_account",
        institution: "Sample Wallet",
        account_id: 31,
        name: "Sample Wallet",
        is_credit_card: false,
        account_identifiers: [],
        custom_mappings_filenames: ["custom_mappings_default.prompt"],
      },
      {
        kind: "rename_institution",
        institution: "Sample Wallet",
        new_name: "Sample Pay",
      },
      {
        kind: "remove_parser",
        institution: "Sample Bank",
        parser: "sample-bank-pdf",
      },
    ]);
    expect(table).toEqual(before);
    expect(after.map((one) => [one.id, one.name, one.parsers])).toEqual([
      [1, "Sample Bank", ["sample-bank-xls"]],
      [2, "Sample Cards", ["sample-cc-xls"]],
      [null, "Sample Pay", ["sample-wallet-csv"]],
    ]);
    expect(after[2].accounts.map((one) => one.account_id)).toEqual([31]);
  });

  it("replaces an updated account's lists whole", () => {
    const after = applied([
      {
        kind: "update_account",
        account_id: 11,
        custom_mappings_filenames: [
          "custom_mappings_personal.prompt",
          "custom_mappings_default.prompt",
        ],
      },
      { kind: "update_account", account_id: 21, name: "Sample Card One" },
    ]);
    expect(after[0].accounts[0]).toEqual({
      ...bank.accounts[0],
      custom_mappings_filenames: [
        "custom_mappings_personal.prompt",
        "custom_mappings_default.prompt",
      ],
    });
    expect(after[1].accounts[0]).toEqual({
      ...cards.accounts[0],
      name: "Sample Card One",
    });
  });

  it("removes an account, then its emptied institution", () => {
    const after = applied([
      { kind: "remove_account", account_id: 11 },
      { kind: "remove_institution", institution: "Sample Bank" },
    ]);
    expect(after.map((one) => one.name)).toEqual(["Sample Cards"]);
  });

  it("refuses to remove an institution that has accounts", () => {
    expect(
      refusal([
        { kind: "remove_account", account_id: 21 },
        { kind: "remove_institution", institution: "Sample Cards" },
      ]),
    ).toMatchObject({ code: "institution_has_accounts", changeIndex: 1 });
  });

  it("refuses a change naming what the table doesn't hold", () => {
    expect(
      refusal([
        {
          kind: "rename_institution",
          institution: "Sample Bank",
          new_name: "Sample One",
        },
        { kind: "add_parser", institution: "Sample Bank", parser: "x" },
      ]),
    ).toMatchObject({ code: "unknown_institution", changeIndex: 1 });
    expect(
      refusal([{ kind: "update_account", account_id: 99, name: "Sample" }]),
    ).toMatchObject({ code: "unknown_account", changeIndex: 0 });
    expect(refusal([{ kind: "remove_account", account_id: 99 }])).toMatchObject(
      { code: "unknown_account" },
    );
    expect(
      refusal([
        {
          kind: "remove_parser",
          institution: "Sample Cards",
          parser: "sample-bank-xls",
        },
      ]),
    ).toMatchObject({ code: "parser_not_listed" });
  });
});

describe("validateImportPresets", () => {
  it("accepts a table that keeps every rule", () => {
    expect(validateImportPresets(table)).toEqual([]);
  });

  it("rule 1: institution names are non-empty and unique", () => {
    expect(codes([institution({ name: " " })])).toEqual([
      "institution_name_empty",
    ]);
    expect(
      codes(
        applied([
          { kind: "add_institution", name: "Sample Bank", parsers: [] },
        ]),
      ),
    ).toEqual(["institution_name_taken"]);
  });

  it("rule 2: a parser is listed once, in one institution", () => {
    expect(
      codes(
        applied([
          {
            kind: "add_parser",
            institution: "Sample Bank",
            parser: "sample-bank-xls",
          },
        ]),
      ),
    ).toEqual(["parser_listed_twice"]);
    expect(
      codes(
        applied([
          {
            kind: "add_parser",
            institution: "Sample Cards",
            parser: "sample-bank-xls",
          },
        ]),
      ),
    ).toEqual(["parser_in_two_institutions"]);
  });

  it("rule 3: an account_id appears once in the table", () => {
    expect(
      codes(
        applied([
          {
            kind: "add_account",
            institution: "Sample Cards",
            account_id: 11,
            name: "Sample Savings Again",
            is_credit_card: false,
            account_identifiers: ["0505050000000011"],
            custom_mappings_filenames: [],
          },
        ]),
      ),
    ).toEqual(["account_listed_twice"]);
  });

  it("rule 4: account names are non-empty and unique in the table", () => {
    expect(
      codes(applied([{ kind: "update_account", account_id: 11, name: "" }])),
    ).toEqual(["account_name_empty"]);
    expect(
      codes(
        applied([
          { kind: "update_account", account_id: 11, name: "Sample Card A" },
        ]),
      ),
    ).toEqual(["account_name_taken"]);
  });

  it("rule 5: identifiers tell an institution's accounts apart", () => {
    expect(
      codes(
        applied([
          {
            kind: "update_account",
            account_id: 22,
            account_identifiers: ["050505XXXXXX0505"],
          },
        ]),
      ),
    ).toEqual(["identifier_on_two_accounts"]);
    expect(
      codes(
        applied([
          { kind: "update_account", account_id: 22, account_identifiers: [] },
        ]),
      ),
    ).toEqual(["account_identifier_required"]);
    // The same identifier in two institutions is two statements' business.
    expect(
      codes(
        applied([
          {
            kind: "update_account",
            account_id: 11,
            account_identifiers: ["050505XXXXXX0505"],
          },
        ]),
      ),
    ).toEqual([]);
  });

  it("rule 6: an account lists a mapping file once", () => {
    expect(
      codes(
        applied([
          {
            kind: "update_account",
            account_id: 11,
            custom_mappings_filenames: [
              "custom_mappings_default.prompt",
              "custom_mappings_default.prompt",
            ],
          },
        ]),
      ),
    ).toEqual(["mapping_file_listed_twice"]);
    // Many accounts may list one file.
    expect(
      codes(
        applied([
          {
            kind: "update_account",
            account_id: 21,
            custom_mappings_filenames: ["custom_mappings_default.prompt"],
          },
        ]),
      ),
    ).toEqual([]);
  });

  it("judges the table a batch leaves, not the steps on the way", () => {
    // A second account needs identifiers on both; the batch adds the first
    // account's identifier after the second account.
    const one = [
      institution({
        id: 1,
        name: "Sample Bank",
        parsers: ["sample-bank-xls"],
        accounts: [account({ account_id: 11, name: "Sample Savings" })],
      }),
    ];
    expect(
      codes(
        applied(
          [
            {
              kind: "add_account",
              institution: "Sample Bank",
              account_id: 12,
              name: "Sample Current",
              is_credit_card: false,
              account_identifiers: ["0505050000000012"],
              custom_mappings_filenames: [],
            },
            {
              kind: "update_account",
              account_id: 11,
              account_identifiers: ["0505050000000011"],
            },
          ],
          one,
        ),
      ),
    ).toEqual([]);
  });
});

describe("presetAdditions", () => {
  it("names the ids and parsers a batch brought in, with the change", () => {
    const changes: ImportPresetChange[] = [
      {
        kind: "add_institution",
        name: "Sample Wallet",
        parsers: ["sample-wallet-csv"],
      },
      {
        kind: "add_parser",
        institution: "Sample Bank",
        parser: "sample-bank-csv",
      },
      {
        kind: "add_account",
        institution: "Sample Wallet",
        account_id: 31,
        name: "Sample Wallet",
        is_credit_card: false,
        account_identifiers: [],
        custom_mappings_filenames: [],
      },
      // Moving an account keeps its id, which is not new.
      { kind: "remove_account", account_id: 11 },
      {
        kind: "add_account",
        institution: "Sample Wallet",
        account_id: 11,
        name: "Sample Savings",
        is_credit_card: false,
        account_identifiers: ["0505050000000011"],
        custom_mappings_filenames: [],
      },
    ];
    const after = applied(changes);
    expect(presetAdditions(table, after, changes)).toEqual({
      accountIds: [{ accountId: 31, changeIndex: 2 }],
      parsers: [
        { parser: "sample-bank-csv", changeIndex: 1 },
        { parser: "sample-wallet-csv", changeIndex: 0 },
      ],
    });
  });
});

describe("importPresetChangeSchema", () => {
  it("refuses a parser or mapping file named by a path", () => {
    expect(() =>
      importPresetChangeSchema.parse({
        kind: "add_parser",
        institution: "Sample Bank",
        parser: "custom-built-parsers/sample-bank-xls",
      }),
    ).toThrow();
    expect(() =>
      importPresetChangeSchema.parse({
        kind: "update_account",
        account_id: 11,
        custom_mappings_filenames: ["../custom_mappings_default.prompt"],
      }),
    ).toThrow();
    expect(() =>
      importPresetChangeSchema.parse({
        kind: "update_account",
        account_id: 11,
        account_identifiers: ["0505 05XX XXXX 0505"],
      }),
    ).toThrow();
  });
});

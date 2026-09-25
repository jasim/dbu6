import { describe, expect, it } from "vitest";
import type {
  ImportAccount,
  ImportInstitution,
} from "../../../shared/index.js";
import { proposeSampleChanges } from "./sample-statement.js";

const account = (
  account_id: number,
  account_identifiers: string[] = [],
): ImportAccount => ({
  account_id,
  name: `Sample ${account_id}`,
  is_credit_card: false,
  account_identifiers,
  custom_mappings_filenames: ["custom_mappings_default.prompt"],
});

const institution = (
  id: number,
  name: string,
  parsers: string[],
  accounts: ImportAccount[],
): ImportInstitution => ({ id, name, parsers, accounts });

describe("proposeSampleChanges", () => {
  it("lists the parser on the account's institution and sets the printed number", () => {
    const presets = [institution(1, "Sample Bank", [], [account(8)])];

    expect(
      proposeSampleChanges(presets, 8, "sample-bank-xls", "050505000012"),
    ).toEqual({
      parserInstitution: null,
      institution: "Sample Bank",
      moves: false,
      identifierState: "set",
      changes: [
        {
          kind: "add_parser",
          institution: "Sample Bank",
          parser: "sample-bank-xls",
        },
        {
          kind: "update_account",
          account_id: 8,
          account_identifiers: ["050505000012"],
        },
      ],
    });
  });

  it("changes nothing when the institution lists the parser and the number is there", () => {
    const presets = [
      institution(
        1,
        "Sample Bank",
        ["sample-bank-xls"],
        [account(8, ["050505000012"])],
      ),
    ];

    expect(
      proposeSampleChanges(presets, 8, "sample-bank-xls", "050505000012"),
    ).toMatchObject({ identifierState: "same", changes: [] });
  });

  it("takes the statement's number on a mismatch", () => {
    const presets = [
      institution(
        1,
        "Sample Bank",
        ["sample-bank-xls"],
        [account(8, ["050505000099", "050505000077"])],
      ),
    ];

    expect(
      proposeSampleChanges(presets, 8, "sample-bank-xls", "050505000012"),
    ).toMatchObject({
      identifierState: "different",
      changes: [
        {
          kind: "update_account",
          account_id: 8,
          account_identifiers: ["050505000012", "050505000077"],
        },
      ],
    });
  });

  it("moves the account to the institution that lists the parser", () => {
    const presets = [
      institution(1, "Sample Bank", [], [account(8)]),
      institution(2, "Sample Cards", ["sample-cc-csv"], [account(9, ["X1"])]),
    ];

    expect(proposeSampleChanges(presets, 8, "sample-cc-csv", null)).toEqual({
      parserInstitution: "Sample Cards",
      institution: "Sample Cards",
      moves: true,
      identifierState: "none_printed",
      changes: [
        { kind: "remove_account", account_id: 8 },
        { kind: "add_account", institution: "Sample Cards", ...account(8) },
      ],
    });
  });

  it("proposes nothing for an account no preset lists", () => {
    expect(proposeSampleChanges([], 8, "sample-bank-xls", null)).toBeNull();
  });
});

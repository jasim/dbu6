import { describe, expect, it } from "vitest";
import { describeBatch, describeFileStatus } from "./describeBatch";
import { describeProblems, parseErrorBody } from "./describeProblems";

const BANK_PARSER = "custom-built-parsers/hdfc-bank-xls/parser.py";

const resolvedRow = {
  status: "resolved" as const,
  file_name: "bank-aug.xls",
  parser_path: BANK_PARSER,
  account: { kind: "bank" as const, identifier: "05050505050505" },
  institution: "HDFC BANK Ltd.",
  preset_name: "Sample Bank",
};

describe("plan rejections", () => {
  it("turns an unrecognised file into a plain card with a parser-building prompt", () => {
    const error = parseErrorBody(
      {
        error: "auto_import_files_unresolved",
        message:
          "1 of 2 uploaded file(s) could not be tied to an import preset, so nothing was imported.",
        hint: "Remove those files, add a saved parser for a layout none recognised, or declare the account's preset in import-presets.json.",
        files: [
          resolvedRow,
          {
            status: "unrecognized",
            file_name: "notes.txt",
            candidate_parser_paths: [],
          },
        ],
      },
      422,
    );
    const [problem] = describeProblems(error);
    expect(describeProblems(error)).toHaveLength(1);
    expect(problem.subject).toBe("notes.txt");
    expect(problem.caption).toBeNull();
    expect(problem.verdict).toBe("The app can't read this file yet.");
    expect(problem.facts).toEqual([
      { label: "Readers tried", value: "none fit this file type" },
    ]);
    expect(problem.why).toContain("none matches this file");
    expect(problem.actions).toEqual([
      {
        kind: "remove-files",
        label: "Remove this file and process the rest",
        fileNames: ["notes.txt"],
      },
    ]);
    expect(problem.agent?.prompt).toContain("The file is called notes.txt");
    expect(problem.agent?.prompt).toContain(
      "custom-built-parsers/import-statement-parser-guide.md",
    );
    expect(problem.agent?.prompt).toContain(
      "data/user-config/import-presets.json",
    );
    expect(problem.agent?.prompt).not.toContain("curl");
    expect(problem.agent?.afterwards).toContain("drop this file again");
    expect(problem.technical).toContain("auto_import_files_unresolved");

    expect(describeBatch({ result: null, error })).toEqual({
      tone: "failure",
      text: "Nothing was imported. 1 of 2 files needs attention below.",
      removedFiles: [],
    });
    expect(
      describeFileStatus(resolvedRow, {
        importedFiles: new Set(),
        failedFiles: new Set(),
      }),
    ).toEqual({
      tone: "pending",
      text: "HDFC BANK Ltd. statement, account ending 0505 → Sample Bank · Ready",
    });
  });

  it("names the readers that were tried", () => {
    const error = parseErrorBody(
      {
        error: "auto_import_files_unresolved",
        files: [
          {
            status: "unrecognized",
            file_name: "card.csv",
            candidate_parser_paths: [
              "custom-built-parsers/hdfc-cc-csv/parser.py",
              "custom-built-parsers/stanc-bank-csv/parser.py",
            ],
          },
        ],
      },
      422,
    );
    const [problem] = describeProblems(error);
    expect(problem.facts).toEqual([
      { label: "Readers tried", value: "hdfc-cc-csv, stanc-bank-csv" },
    ]);
    expect(problem.agent?.prompt).toContain(
      "custom-built-parsers/hdfc-cc-csv/parser.py",
    );
  });

  it("explains a statement whose account is not set up, with the identifier in the prompt", () => {
    const error = parseErrorBody(
      {
        error: "auto_import_files_unresolved",
        files: [
          {
            status: "unresolved",
            file_name: "card-aug.xls",
            parser_path: "custom-built-parsers/hdfc-cc-xls/parser.py",
            account: { kind: "card", identifier: "050505XXXXXX0505" },
            institution: "HDFC Bank Cards Division",
            reason: "no_preset_for_parser",
            message:
              "No import preset uses custom-built-parsers/hdfc-cc-xls/parser.py, which parsed card-aug.xls.",
            candidate_preset_names: [],
          },
        ],
      },
      422,
    );
    const [problem] = describeProblems(error);
    expect(problem.subject).toBe("HDFC Bank Cards Division");
    expect(problem.caption).toBe("card-aug.xls · card ending 0505");
    expect(problem.verdict).toBe(
      "No account is set up to receive this statement.",
    );
    expect(problem.facts).toEqual([
      { label: "Statement is for", value: "card ending 0505" },
      { label: "Reader", value: "hdfc-cc-xls" },
    ]);
    expect(problem.agent?.prompt).toContain(
      "statement_account_identifier to 050505XXXXXX0505",
    );
    expect(problem.agent?.prompt).toContain("curl");
  });

  it("tells a mismatched account apart from a mistaken drop", () => {
    const error = parseErrorBody(
      {
        error: "auto_import_files_unresolved",
        files: [
          {
            status: "unresolved",
            file_name: "other.xls",
            parser_path: BANK_PARSER,
            account: { kind: "bank", identifier: "050505000099" },
            institution: "HDFC BANK Ltd.",
            reason: "statement_account_identifier_mismatch",
            message:
              'other.xls reports account identifier 050505000099, but the only preset using the parser ("Sample Bank") expects 05050505050505.',
            candidate_preset_names: ["Sample Bank"],
          },
        ],
      },
      422,
    );
    const [problem] = describeProblems(error);
    expect(problem.subject).toBe("HDFC BANK Ltd.");
    expect(problem.caption).toBe("other.xls · account ending 0099");
    expect(problem.verdict).toBe(
      "This statement is for a different account than the one set up.",
    );
    expect(problem.facts).toEqual([
      { label: "Statement is for", value: "account ending 0099" },
      { label: "Set up for these statements", value: "Sample Bank" },
    ]);
    expect(problem.actions[0]).toMatchObject({ kind: "remove-files" });
    expect(problem.agent?.prompt).toContain("050505000099");
  });
});

describe("account import failures", () => {
  const failedGroup = {
    preset_name: "Sample Bank",
    base_account: "assets:bank:sample",
    is_credit_card: false,
    file_names: ["bank-aug.xls"],
  };

  it("explains a closing balance that does not add up, with the numbers", () => {
    const error = parseErrorBody(
      {
        error: "balance_mismatch",
        message:
          "Final calculated balance (2400) does not match closing balance from statement (2500). Difference: 100, tolerance: 0.01",
        computed_final: 2400,
        statement_closing: 2500,
        difference: 100,
        tolerance: 0.01,
        files: [resolvedRow],
        failed_group: failedGroup,
      },
      422,
    );
    const [problem] = describeProblems(error);
    expect(problem.subject).toBe("Sample Bank");
    expect(problem.caption).toBe("bank-aug.xls");
    expect(problem.verdict).toBe(
      "The transactions don't add up to the closing balance the statement prints.",
    );
    expect(problem.facts).toEqual([
      { label: "Opening plus every transaction", value: "₹2,400.00" },
      { label: "Closing the statement prints", value: "₹2,500.00" },
      { label: "Difference", value: "₹100.00" },
    ]);
    expect(problem.why).toContain("one row was read wrongly");
    expect(problem.agent?.prompt).toContain(
      "into Sample Bank (assets:bank:sample)",
    );
    expect(problem.agent?.prompt).toContain(BANK_PARSER);
    expect(problem.agent?.prompt).toContain("difference 100");
    expect(problem.agent?.prompt).toContain("import-draft/statements/auto");
    expect(problem.fileNames).toEqual(["bank-aug.xls"]);
    expect(describeBatch({ result: null, error })).toMatchObject({
      tone: "failure",
      text: "Nothing was imported. Sample Bank failed, see below.",
    });
    expect(
      describeFileStatus(resolvedRow, {
        importedFiles: new Set(),
        failedFiles: new Set(["bank-aug.xls"]),
      }).text,
    ).toContain("Not imported, see below");
  });

  it("offers to remove a duplicate upload without an agent", () => {
    const error = parseErrorBody(
      {
        error: "statement_boundary_mismatch",
        message: "Statement boundary mismatch ...",
        hint: "bank-aug-copy.xls covers the same dates as bank-aug.xls and starts and ends at the same balances: it is almost certainly the same statement uploaded twice.",
        earlier_source: "bank-aug.xls",
        later_source: "bank-aug-copy.xls",
        earlier_closing: 2500,
        later_opening: 1000,
        difference: -1500,
        files: [resolvedRow],
        failed_group: {
          ...failedGroup,
          file_names: ["bank-aug.xls", "bank-aug-copy.xls"],
        },
      },
      422,
    );
    const [problem] = describeProblems(error);
    expect(problem.verdict).toBe(
      "bank-aug-copy.xls looks like the same statement as bank-aug.xls.",
    );
    expect(problem.facts).toEqual([]);
    expect(problem.agent).toBeNull();
    expect(problem.actions).toEqual([
      {
        kind: "remove-files",
        label: "Remove bank-aug-copy.xls and process again",
        fileNames: ["bank-aug-copy.xls"],
      },
    ]);
  });

  it("describes a gap between statements and lets the user import the earlier one alone", () => {
    const error = parseErrorBody(
      {
        error: "statement_boundary_mismatch",
        message: "Statement boundary mismatch ...",
        earlier_source: "bank-jul.xls",
        later_source: "bank-sep.xls",
        earlier_closing: 2500,
        later_opening: 4000,
        difference: 1500,
        files: [],
        failed_group: {
          ...failedGroup,
          file_names: ["bank-jul.xls", "bank-sep.xls"],
        },
      },
      422,
    );
    const [problem] = describeProblems(error);
    expect(problem.verdict).toBe(
      "There is a gap between bank-jul.xls and bank-sep.xls.",
    );
    expect(problem.facts).toEqual([
      { label: "bank-jul.xls ends at", value: "₹2,500.00" },
      { label: "bank-sep.xls begins at", value: "₹4,000.00" },
      { label: "Activity in neither file", value: "₹1,500.00" },
    ]);
    expect(problem.actions).toEqual([
      {
        kind: "keep-only-files",
        label: "Process bank-jul.xls on its own",
        fileNames: ["bank-jul.xls"],
      },
    ]);
    expect(problem.agent?.prompt).toContain("bank-jul.xls ends at\n2500");
  });

  it("explains a reconciliation mismatch in terms of the last confirmed balance", () => {
    const error = parseErrorBody(
      {
        error: "reconciliation_match_failed",
        message:
          "Statement has 2 row(s) on 2026-08-31 but none carry the asserted balance 2500 ...",
        checkpoint_date: "2026-08-31",
        checkpoint_balance: 2500,
        files: [resolvedRow],
        failed_group: failedGroup,
      },
      422,
    );
    const [problem] = describeProblems(error);
    expect(problem.verdict).toBe(
      "The statement doesn't line up with your books.",
    );
    expect(problem.facts).toEqual([
      { label: "Books last confirmed on", value: "31 Aug 2026" },
      { label: "Confirmed balance", value: "₹2,500.00" },
    ]);
    expect(problem.agent?.prompt).toContain(
      "balance assertion for assets:bank:sample",
    );
  });

  it("removes the already-imported files after a partial failure", () => {
    const error = parseErrorBody(
      {
        error: "closing_balance_unavailable",
        message: "Closing balance required ...",
        files: [resolvedRow],
        failed_group: {
          preset_name: "Sample Card",
          base_account: "liabilities:card:sample",
          is_credit_card: true,
          file_names: ["card-aug.xls"],
        },
        imported_groups: [
          {
            preset_name: "Sample Bank",
            base_account: "assets:bank:sample",
            is_credit_card: false,
            file_names: ["bank-aug.xls"],
            result: {},
          },
        ],
        partial_import: 'Sample Bank imported before "Sample Card" failed.',
      },
      400,
    );
    expect(describeBatch({ result: null, error })).toEqual({
      tone: "partial",
      text: "Sample Bank was imported. Sample Card failed, see below.",
      removedFiles: ["bank-aug.xls"],
    });
    const [problem] = describeProblems(error);
    expect(problem.subject).toBe("Sample Card");
    expect(problem.caption).toBe("card-aug.xls");
    expect(problem.verdict).toBe(
      "The app needs the closing balance for this card.",
    );
    expect(problem.actions).toEqual([
      {
        kind: "link",
        label: "Open the manual import screen",
        to: "/views/import-statement",
      },
    ]);
  });

  it("falls back to a generic card and a full-payload prompt for unknown codes", () => {
    const error = parseErrorBody(
      {
        error: "something_new",
        message: "An unexpected thing happened.",
        files: [],
        failed_group: failedGroup,
      },
      422,
    );
    const [problem] = describeProblems(error);
    expect(problem.subject).toBe("Sample Bank");
    expect(problem.verdict).toBe(
      "The import stopped with an unexpected error.",
    );
    expect(problem.why).toBe("An unexpected thing happened.");
    expect(problem.agent?.prompt).toContain('"error": "something_new"');
  });

  it("explains a lost connection and a missing permission without an agent", () => {
    expect(describeProblems(parseErrorBody(null, 403))[0].verdict).toBe(
      "You don't have permission to import.",
    );
    const [problem] = describeProblems(parseErrorBody(null, 0));
    expect(problem.subject).toBe("Connection");
    expect(problem.verdict).toBe("The files could not be sent.");
    expect(problem.agent).toBeNull();
  });
});

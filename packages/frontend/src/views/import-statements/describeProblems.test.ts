import { describe, expect, it } from "vitest";
import type {
  AutoImportGroupResult,
  AutoImportPlanFile,
  StatementImportError,
  StatementImportErrorCode,
} from "dbu6-shared";
import { describeBatch, describeFileStatus } from "./describeBatch";
import {
  describeProblems,
  FREEFORM_IMPORT_ROUTE,
  problemTone,
} from "./describeProblems";
import { readImportResponse, type ImportFailure } from "./outcome";

const BANK_PARSER = "custom-built-parsers/hdfc-bank-xls/parser.py";

/** The failure a refused reply parses to. */
function refused(status: number, body: unknown): ImportFailure {
  const outcome = readImportResponse(status, body);
  if (outcome.kind !== "failed") throw new Error("expected a failed import");
  return outcome.failure;
}

/** The server's reply when some file couldn't be tied to a preset. */
function planRejection(files: AutoImportPlanFile[]) {
  const unplaced = files.filter((file) => file.status !== "resolved").length;
  return {
    error: "auto_import_files_unresolved",
    message: `${unplaced} of ${files.length} uploaded file(s) could not be tied to an import preset, so nothing was imported.`,
    hint: "Remove those files, add a saved parser for a layout none recognised, or declare the account's preset in import-presets.json.",
    files,
  };
}

function importedGroup(
  extra: Partial<AutoImportGroupResult>,
): AutoImportGroupResult {
  return {
    preset_name: "Sample Bank",
    base_account: "assets:bank:sample",
    is_credit_card: false,
    file_names: ["bank-aug.xls"],
    ...extra,
    result: {
      hledger_journal: "",
      transaction_count: 6,
      skipped_reconciled_count: 0,
      draft_transaction_count: 6,
      duplicate_count: 0,
      draft_duplicate_count: 0,
      journal_duplicate_count: 0,
      legacy_match_count: 0,
      backfilled_count: 0,
      same_account_skips: [],
      gpay_enriched_count: 0,
      categorization: {
        agent: "claude-code",
        sent_count: 6,
        failed_count: 0,
        error: null,
      },
      opening_balance: 1000,
      closing_balance_from_statement: 2500,
      balance_metadata: {
        opening: { extracted: 1000, effective: 1000, source: "statement" },
        closing: { extracted: 2500, effective: 2500, source: "statement" },
      },
      statement_period: { first_date: "2026-08-01", last_date: "2026-08-31" },
      reconciliation_checkpoint: null,
    },
  };
}

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
    const unrecognized: AutoImportPlanFile = {
      status: "unrecognized",
      file_name: "notes.txt",
      candidate_parser_paths: [],
    };
    const error = refused(422, planRejection([resolvedRow, unrecognized]));
    const [problem] = describeProblems(error);
    expect(describeProblems(error)).toHaveLength(1);
    expect(problem.subject).toBe("notes.txt");
    expect(problem.caption).toBeNull();
    expect(problem.verdict).toBe("The app can't read this file yet.");
    expect(problem.facts).toEqual([
      {
        label: "Readers tried",
        value: "none fit this file type",
        face: "words",
      },
    ]);
    expect(problem.why).toContain("none matches this file");
    expect(problem.tone).toBe("attention");
    expect(problem.actions).toEqual([
      {
        kind: "remove-files",
        label: "Remove this file and import the rest",
        fileNames: ["notes.txt"],
      },
      {
        kind: "link",
        label: "Import them freeform instead",
        to: FREEFORM_IMPORT_ROUTE,
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

    expect(describeBatch({ kind: "failed", failure: error })).toEqual({
      tone: "attention",
      text: "Nothing was imported. 1 of 2 files needs attention below.",
      next: "There is likely no matching parser for this statement format",
    });
    expect(
      describeFileStatus(resolvedRow, {
        importedFiles: new Set(),
        failed: null,
      }),
    ).toEqual({
      tone: "waiting",
      text: "HDFC BANK Ltd. statement, account ending 0505 → Sample Bank · Ready",
    });
    expect(
      describeFileStatus(unrecognized, {
        importedFiles: new Set(),
        failed: null,
      }),
    ).toEqual({ tone: "attention", text: "Not recognised, see below" });
  });

  it("names the readers that were tried", () => {
    const error = refused(
      422,
      planRejection([
        {
          status: "unrecognized",
          file_name: "card.csv",
          candidate_parser_paths: [
            "custom-built-parsers/hdfc-cc-csv/parser.py",
            "custom-built-parsers/stanc-bank-csv/parser.py",
          ],
        },
      ]),
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
    const error = refused(
      422,
      planRejection([
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
      ]),
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
    const error = refused(
      422,
      planRejection([
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
      ]),
    );
    const [problem] = describeProblems(error);
    expect(problem.subject).toBe("HDFC BANK Ltd.");
    expect(problem.caption).toBe("other.xls · account ending 0099");
    expect(problem.verdict).toBe(
      "This statement is for a different account than the one set up.",
    );
    expect(problem.facts).toEqual([
      { label: "Statement is for", value: "account ending 0099" },
      {
        label: "Set up for these statements",
        value: "Sample Bank",
        face: "words",
      },
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
    const error = refused(422, {
      error: "balance_mismatch",
      message:
        "Final calculated balance (2400) does not match closing balance from statement (2500). Difference: 100, tolerance: 0.01",
      computed_final: 2400,
      statement_closing: 2500,
      difference: 100,
      tolerance: 0.01,
      suspected_gap: false,
      files: [resolvedRow],
      failed_group: failedGroup,
    });
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
    expect(problem.tone).toBe("problem");
    expect(describeBatch({ kind: "failed", failure: error })).toMatchObject({
      tone: "problem",
      text: "Nothing was imported. Sample Bank failed, see below.",
    });
    expect(
      describeFileStatus(resolvedRow, {
        importedFiles: new Set(),
        failed: { files: new Set(["bank-aug.xls"]), tone: problem.tone },
      }),
    ).toEqual({
      tone: "problem",
      text: "HDFC BANK Ltd. statement, account ending 0505 → Sample Bank · Not imported, see below",
    });
  });

  it("reads a gap as the likely cause when the statement prints no running balances", () => {
    const [problem] = describeProblems(
      refused(422, {
        ...PAYLOADS.balance_mismatch,
        suspected_gap: true,
        files: [resolvedRow],
        failed_group: failedGroup,
      }),
    );
    expect(problem.why).toContain("there is a gap");
    expect(problem.steps).toHaveLength(1);
  });

  it("offers to remove a duplicate upload without an agent", () => {
    const error = refused(422, {
      error: "statement_boundary_mismatch",
      message: "Statement boundary mismatch ...",
      reason: "same-statement-twice",
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
    });
    const [problem] = describeProblems(error);
    expect(problem.verdict).toBe(
      "bank-aug-copy.xls looks like the same statement as bank-aug.xls.",
    );
    expect(problem.facts).toEqual([]);
    expect(problem.agent).toBeNull();
    expect(problem.actions).toEqual([
      {
        kind: "remove-files",
        label: "Remove bank-aug-copy.xls and import again",
        fileNames: ["bank-aug-copy.xls"],
      },
    ]);
  });

  it("describes a gap between statements and lets the user import the earlier one alone", () => {
    const error = refused(422, {
      error: "statement_boundary_mismatch",
      message: "Statement boundary mismatch ...",
      reason: "gap",
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
    });
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
        label: "Import bank-jul.xls on its own",
        fileNames: ["bank-jul.xls"],
      },
    ]);
    expect(problem.agent?.prompt).toContain("bank-jul.xls ends at\n2500");
  });

  it("explains a reconciliation mismatch in terms of the last confirmed balance", () => {
    const error = refused(422, {
      error: "reconciliation_match_failed",
      message:
        "Statement has 2 row(s) on 2026-08-31 but none carry the asserted balance 2500 ...",
      checkpoint_date: "2026-08-31",
      checkpoint_balance: 2500,
      files: [resolvedRow],
      failed_group: failedGroup,
    });
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
    const error = refused(400, {
      error: "closing_balance_unavailable",
      message: "Closing balance required ...",
      files: [resolvedRow],
      failed_group: {
        preset_name: "Sample Card",
        base_account: "liabilities:card:sample",
        is_credit_card: true,
        file_names: ["card-aug.xls"],
      },
      imported_groups: [importedGroup({ file_names: ["bank-aug.xls"] })],
      partial_import: 'Sample Bank imported before "Sample Card" failed.',
    });
    expect(describeBatch({ kind: "failed", failure: error })).toEqual({
      tone: "attention",
      text: "Sample Bank was imported. Sample Card failed, see below.",
      next: "bank-aug.xls has been taken out of the list above. Fix the problem below and import the rest.",
    });
    const [problem] = describeProblems(error);
    expect(problem.subject).toBe("Sample Card");
    expect(problem.caption).toBe("card-aug.xls");
    expect(problem.verdict).toBe(
      "The app needs the closing balance for this card.",
    );
    expect(problem.actions).toEqual([]);
    expect(problem.agent?.prompt).toContain("emit it as `closing`");
  });

  it("gives a known code without a card of its own the generic card and a full-payload prompt", () => {
    const [problem] = describeProblems(
      refused(422, {
        ...PAYLOADS.ambiguous_duplicate,
        files: [],
        failed_group: failedGroup,
      }),
    );
    expect(problem.subject).toBe("Sample Bank");
    expect(problem.verdict).toBe(
      "The import stopped with an unexpected error.",
    );
    expect(problem.why).toBe(PAYLOADS.ambiguous_duplicate.message);
    expect(problem.agent?.prompt).toContain('"error": "ambiguous_duplicate"');
  });

  it("keeps a reply the contract doesn't describe in the technical details", () => {
    const error = refused(422, {
      error: "something_new",
      message: "An unexpected thing happened.",
      files: [],
      failed_group: failedGroup,
    });
    expect(error.kind).toBe("unexpected");
    const [problem] = describeProblems(error);
    expect(problem.verdict).toBe(
      "The import stopped with an unexpected error.",
    );
    expect(problem.agent).toBeNull();
    expect(problem.technical).toContain('"error": "something_new"');
    expect(describeBatch({ kind: "failed", failure: error }).text).toBe(
      "Nothing was imported.",
    );
  });

  it("explains a lost connection and a missing permission without an agent", () => {
    expect(
      describeProblems(refused(403, { error: "Forbidden" }))[0].verdict,
    ).toBe("You don't have permission to import.");
    const [problem] = describeProblems({
      kind: "network",
      message: "Failed to fetch",
    });
    expect(problem.subject).toBe("Connection");
    expect(problem.verdict).toBe("The files could not be sent.");
    expect(problem.agent).toBeNull();
  });
});

describe("problem tones", () => {
  const failedGroup = {
    preset_name: "Sample Bank",
    base_account: "assets:bank:sample",
    is_credit_card: false,
    file_names: ["bank-aug.xls"],
  };

  function toneOf(code: StatementImportErrorCode) {
    const error = refused(422, {
      ...PAYLOADS[code],
      files: [],
      failed_group: failedGroup,
    });
    expect(error.kind, code).toBe("account-refused");
    const tones = describeProblems(error).map((problem) => problem.tone);
    expect(new Set(tones)).toEqual(new Set([problemTone(error)]));
    return problemTone(error);
  }

  it("marks the numbers that don't add up as destructive", () => {
    for (const code of [
      "balance_mismatch",
      "segment_balance_mismatch",
      "statement_boundary_mismatch",
      "statement_disagreement",
      "statement_part_invalid",
      "reconciliation_match_failed",
      "assertion_conflict",
    ] as const) {
      expect(toneOf(code), code).toBe("problem");
    }
  });

  it("marks what needs setting up as attention", () => {
    for (const code of [
      "opening_balance_unavailable",
      "closing_balance_unavailable",
      "statement_part_unjoinable",
    ] as const) {
      expect(toneOf(code), code).toBe("attention");
    }
    expect(problemTone(refused(403, { error: "Forbidden" }))).toBe("attention");
    const plan = refused(
      422,
      planRejection([
        {
          status: "unrecognized",
          file_name: "notes.html",
          candidate_parser_paths: [],
        },
        {
          status: "ambiguous",
          file_name: "bank.csv",
          matching_parser_paths: [BANK_PARSER, BANK_PARSER],
        },
        ...(
          [
            "no_preset_for_parser",
            "statement_account_identifier_required",
            "statement_account_identifier_mismatch",
          ] as const
        ).map((reason) => ({
          ...resolvedRow,
          status: "unresolved" as const,
          file_name: `${reason}.xls`,
          reason,
          message: "sample",
          candidate_preset_names: ["Sample Bank"],
        })),
      ]),
    );
    const problems = describeProblems(plan);
    expect(problems).toHaveLength(5);
    expect(problems.every((problem) => problem.tone === "attention")).toBe(
      true,
    );
  });

  it("gives the connection and unexpected-error cards the destructive tone", () => {
    const network: ImportFailure = { kind: "network", message: "offline" };
    expect(problemTone(network)).toBe("problem");
    expect(describeProblems(network)[0].tone).toBe("problem");
    for (const code of [
      "ambiguous_duplicate",
      "abacus_json_parse_failed",
      "categorization_config_error",
    ] as const) {
      expect(toneOf(code), code).toBe("problem");
    }
    expect(problemTone(refused(500, "Internal Server Error"))).toBe("problem");
  });

  it("shows the difference for a running balance that drifts", () => {
    const [problem] = describeProblems(
      refused(422, {
        ...PAYLOADS.segment_balance_mismatch,
        files: [resolvedRow],
        failed_group: failedGroup,
      }),
    );
    expect(problem.facts).toEqual([
      { label: "Printed on 1 Aug 2026", value: "₹1,000.00" },
      { label: "Transactions lead to, on 10 Aug 2026", value: "₹2,400.00" },
      { label: "Printed on 10 Aug 2026", value: "₹2,500.00" },
      { label: "Difference", value: "₹100.00" },
    ]);
    // The prompt names the error the server sent and the segment's own figures.
    expect(problem.agent?.prompt).toContain("error segment_balance_mismatch.");
    expect(problem.agent?.prompt).toContain(
      "From the balance 1000 printed on 2026-08-01, the rows lead to 2400 on 2026-08-10, where the statement prints 2500, difference 100.",
    );
  });

  it("leaves a mismatch across several files to the server's own gap call", () => {
    const [problem] = describeProblems(
      refused(422, {
        ...PAYLOADS.balance_mismatch,
        files: [resolvedRow],
        failed_group: {
          ...failedGroup,
          file_names: ["bank-aug.xls", "bank-sep.xls"],
        },
      }),
    );
    expect(problem.why).toContain("one row was read wrongly");
    expect(problem.agent?.prompt).toContain("error balance_mismatch.");
  });
});

/** A body for every statement import error code, as the server sends it. */
const PAYLOADS: {
  [Code in StatementImportErrorCode]: Extract<
    StatementImportError,
    { error: Code }
  >;
} = {
  reconciliation_match_failed: {
    error: "reconciliation_match_failed",
    message: "Statement has no row carrying the asserted balance.",
    checkpoint_date: "2026-08-31",
    checkpoint_balance: 2500,
  },
  balance_mismatch: {
    error: "balance_mismatch",
    message: "Final calculated balance does not match the closing balance.",
    computed_final: 2400,
    statement_closing: 2500,
    difference: 100,
    tolerance: 0.01,
    suspected_gap: false,
  },
  segment_balance_mismatch: {
    error: "segment_balance_mismatch",
    message: "Running balance drift inside the statement.",
    from_date: "2026-08-01",
    to_date: "2026-08-10",
    from_balance: 1000,
    walked: 2400,
    printed: 2500,
    difference: 100,
    tolerance: 0.01,
  },
  opening_balance_unavailable: {
    error: "opening_balance_unavailable",
    message: "Opening balance required.",
  },
  closing_balance_unavailable: {
    error: "closing_balance_unavailable",
    message: "Closing balance required.",
  },
  statement_boundary_mismatch: {
    error: "statement_boundary_mismatch",
    message: "Statement boundary mismatch.",
    reason: "gap",
    earlier_source: "bank-jul.xls",
    later_source: "bank-sep.xls",
    earlier_closing: 2500,
    later_opening: 4000,
    difference: 1500,
  },
  statement_disagreement: {
    error: "statement_disagreement",
    message: "Statement parts disagree.",
    parts: ["bank-aug.xls", "bank-aug-2.xls"],
    date: "2026-08-18",
    row: {
      part: "bank-aug-2.xls",
      narration: "NOPII sample payee",
      withdrawal: 300,
      deposit: 0,
      balance: null,
    },
  },
  statement_part_unjoinable: {
    error: "statement_part_unjoinable",
    message: "Statement part prints no balances.",
    part: "bank-aug.xls",
  },
  statement_part_invalid: {
    error: "statement_part_invalid",
    message: "Statement part is not self-consistent.",
    part: "bank-aug.xls",
    detail: "its declared opening does not match its first row",
  },
  ambiguous_duplicate: {
    error: "ambiguous_duplicate",
    message: "Transaction matches multiple existing candidates.",
    source_transaction_key: null,
    candidate_ids: [1, 2],
  },
  assertion_conflict: {
    error: "assertion_conflict",
    message: "Balance assertion conflict.",
    date: "2026-08-31",
    existing_assertion: 2500,
    expected_assertion: 2400,
  },
  abacus_json_parse_failed: {
    error: "abacus_json_parse_failed",
    message: "Could not parse the uploaded JSON as abacus rows.",
    detail: "rows: expected array",
  },
  categorization_config_error: {
    error: "categorization_config_error",
    message: "transaction_mappings.mjs is missing.",
  },
};

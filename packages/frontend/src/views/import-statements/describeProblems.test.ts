import { describe, expect, it } from "vitest";
import type {
  AutoImportGroupResult,
  AutoImportPlanFile,
  StatementImportError,
  StatementImportErrorCode,
} from "dbu6-shared";
import {
  describeBatch,
  describeFileStatus,
  describeStatement,
} from "./describeBatch";
import {
  describeProblems,
  FREEFORM_IMPORT_ROUTE,
  placeProblems,
  problemTone,
  type Problem,
} from "./describeProblems";
import {
  plannedFiles,
  readImportResponse,
  type ImportFailure,
} from "./outcome";
import { formatDate, formatMoney, parserLabel } from "../../format";

// These tests pin what the screen makes of each failure: which problems it
// raises, their tone and files, what the user can do about them, and the
// figures, files and identifiers they carry to the user and the agent. The
// wording of titles, labels and sentences is free to change.

const BANK_PARSER = "custom-built-parsers/hdfc-bank-xls/parser.py";

/** Where the app staged an upload of a batch it could not import. */
function staged(fileName: string): string {
  return `tmp/statement-uploads/2026-09-09T05-05-05-0505/0-${fileName}`;
}

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

/** The figures and names a problem folds under Details. */
function factValues(problem: Problem): string[] {
  return problem.facts.map((fact) => fact.value);
}

function importedGroup(
  extra: Partial<AutoImportGroupResult>,
): AutoImportGroupResult {
  return {
    preset_name: "Sample Bank",
    base_account: "Sample Bank",
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
      categorization_tally: {
        by_rule: 2,
        by_llm: 3,
        same_account: 0,
        uncategorized: 1,
        accounts: [
          { account_id: 7, account_name: "Groceries", count: 3 },
          { account_id: 8, account_name: "Dining", count: 2 },
        ],
      },
      base_account_id: 1,
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
  saved_path: staged("bank-aug.xls"),
  parser_path: BANK_PARSER,
  account: { kind: "bank" as const, identifier: "05050505050505" },
  institution: "HDFC BANK Ltd.",
  preset_name: "Sample Bank",
};

describe("plan rejections", () => {
  it("turns an unrecognised file into one problem with a parser-building prompt", () => {
    const unrecognized: AutoImportPlanFile = {
      status: "unrecognized",
      file_name: "notes.txt",
      saved_path: staged("notes.txt"),
      candidate_parser_paths: [],
    };
    const error = refused(422, planRejection([resolvedRow, unrecognized]));
    const problems = describeProblems(error);
    expect(problems).toHaveLength(1);
    const [problem] = problems;
    expect(problem).toMatchObject({
      subject: "notes.txt",
      fileNames: ["notes.txt"],
      tone: "attention",
    });
    // Removing the file is the × on the row the problem sits under, so the
    // one action is the way out to a freeform import.
    expect(problem.actions).toEqual([
      expect.objectContaining({ kind: "link", to: FREEFORM_IMPORT_ROUTE }),
    ]);
    // The prompt points the agent at the copy the app kept inside the
    // repository it starts in, instead of describing the file.
    const prompt = problem.agent?.prompt;
    expect(prompt).toContain(staged("notes.txt"));
    expect(prompt).toContain(
      "custom-built-parsers/import-statement-parser-guide.md",
    );
    expect(prompt).toContain("data/user-config/import-presets.json");
    expect(prompt).not.toContain("curl");
    expect(problem.technical).toContain("auto_import_files_unresolved");

    const summary = describeBatch({ kind: "failed", failure: error });
    expect(summary).toMatchObject({ tone: "attention", next: null });
    // It counts the files holding the rest up: 1 of 2.
    expect(summary.text).toMatch(/\b1\b.*\b2\b/);

    // The file that was fine waits, saying what it was read as.
    const ready = describeFileStatus(resolvedRow, {
      importedFiles: new Set(),
      failed: null,
    });
    expect(ready.tone).toBe("waiting");
    expect(ready.text).toContain(describeStatement(resolvedRow));
    expect(
      describeFileStatus(unrecognized, {
        importedFiles: new Set(),
        failed: null,
      }).tone,
    ).toBe("attention");
    expect(describeStatement(unrecognized)).toBeNull();
  });

  it("names the parsers that were tried", () => {
    const tried = [
      "custom-built-parsers/hdfc-cc-csv/parser.py",
      "custom-built-parsers/stanc-bank-csv/parser.py",
    ];
    const [problem] = describeProblems(
      refused(
        422,
        planRejection([
          {
            status: "unrecognized",
            file_name: "card.csv",
            saved_path: staged("card.csv"),
            candidate_parser_paths: tried,
          },
        ]),
      ),
    );
    for (const path of tried) {
      expect(factValues(problem).join(" ")).toContain(parserLabel(path));
      expect(problem.agent?.prompt).toContain(path);
    }
  });

  it("asks for the account to be set up, with the statement's identifier in the prompt", () => {
    const parser = "custom-built-parsers/hdfc-cc-xls/parser.py";
    const error = refused(
      422,
      planRejection([
        {
          status: "unresolved",
          file_name: "card-aug.xls",
          saved_path: staged("card-aug.xls"),
          parser_path: parser,
          account: { kind: "card", identifier: "050505XXXXXX0505" },
          institution: "HDFC Bank Cards Division",
          reason: "no_preset_for_parser",
          message: `No import preset uses ${parser}, which parsed card-aug.xls.`,
          candidate_preset_names: [],
        },
      ]),
    );
    const [problem] = describeProblems(error);
    expect(problem).toMatchObject({
      subject: "HDFC Bank Cards Division",
      fileNames: ["card-aug.xls"],
      tone: "attention",
    });
    expect(factValues(problem)).toContain(parserLabel(parser));
    // The file's row, which the problem sits under, says what it was read as.
    const [row] = plannedFiles({ kind: "failed", failure: error });
    expect(describeStatement(row)).toContain("HDFC Bank Cards Division");
    expect(describeStatement(row)).toContain("0505");
    expect(problem.agent?.prompt).toContain("050505XXXXXX0505");
    expect(problem.agent?.prompt).toContain(staged("card-aug.xls"));
  });

  it("doesn't count the files when the one file dropped is the problem", () => {
    const error = refused(
      422,
      planRejection([
        {
          status: "unresolved",
          file_name: "bank-aug.xls",
          saved_path: staged("bank-aug.xls"),
          parser_path: BANK_PARSER,
          account: { kind: "bank", identifier: "05050505050505" },
          institution: "HDFC BANK Ltd.",
          reason: "no_preset_for_parser",
          message: `No import preset uses ${BANK_PARSER}, which parsed bank-aug.xls.`,
          candidate_preset_names: [],
        },
      ]),
    );
    const summary = describeBatch({ kind: "failed", failure: error });
    expect(summary).toMatchObject({ tone: "attention", next: null });
    expect(summary.text).not.toMatch(/\d/);
    const [problem] = describeProblems(error);
    expect(problem.actions).toEqual([]);
  });

  it("names the preset a statement for a different account didn't match", () => {
    const error = refused(
      422,
      planRejection([
        {
          status: "unresolved",
          file_name: "other.xls",
          saved_path: staged("other.xls"),
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
    expect(problem).toMatchObject({
      subject: "HDFC BANK Ltd.",
      fileNames: ["other.xls"],
      tone: "attention",
    });
    expect(factValues(problem)).toContain("Sample Bank");
    expect(problem.agent?.prompt).toContain("050505000099");
  });
});

describe("account import failures", () => {
  const failedGroup = {
    preset_name: "Sample Bank",
    base_account: "Sample Bank",
    is_credit_card: false,
    file_names: ["bank-aug.xls"],
  };

  /** The problem for a closing balance that doesn't add up. */
  function balanceMismatch(
    suspectedGap: boolean,
    fileNames: string[] = ["bank-aug.xls"],
  ): Problem {
    const [problem] = describeProblems(
      refused(422, {
        ...PAYLOADS.balance_mismatch,
        suspected_gap: suspectedGap,
        files: [resolvedRow],
        failed_group: { ...failedGroup, file_names: fileNames },
      }),
    );
    return problem;
  }

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
    expect(problem).toMatchObject({
      subject: "Sample Bank",
      fileNames: ["bank-aug.xls"],
      tone: "problem",
      actions: [],
    });
    expect(factValues(problem)).toEqual([
      formatMoney(2400),
      formatMoney(2500),
      formatMoney(100),
    ]);
    // The difference reads in the context too, without opening Details.
    expect(problem.context).toContain(formatMoney(100));
    // The prompt names the error, the account, its parser and the figures,
    // and hands over the account's own files to read and to post back.
    const prompt = problem.agent?.prompt;
    expect(prompt).toContain("balance_mismatch");
    expect(prompt).toContain("Sample Bank");
    expect(prompt).toContain(BANK_PARSER);
    expect(prompt).toMatch(/\b100\b/);
    expect(prompt).toContain("import-draft/statements/auto");
    expect(prompt).toContain(staged("bank-aug.xls"));

    expect(describeBatch({ kind: "failed", failure: error })).toMatchObject({
      tone: "problem",
      next: null,
    });
    const status = describeFileStatus(resolvedRow, {
      importedFiles: new Set(),
      failed: {
        files: new Set(["bank-aug.xls"]),
        tone: problem.tone,
        host: null,
      },
    });
    expect(status.tone).toBe("problem");
    expect(status.text).toContain(describeStatement(resolvedRow));
  });

  it("points at a missing statement instead of a misread row when the server suspects a gap", () => {
    const misread = balanceMismatch(false);
    const gap = balanceMismatch(true);
    expect(gap.tone).toBe("problem");
    expect(gap.fix).not.toBe(misread.fix);
    expect(gap.context).not.toBe(misread.context);
    expect(gap.agent?.goal).not.toBe(misread.agent?.goal);
  });

  it("leaves a mismatch across several files to the server's own gap call", () => {
    const misread = balanceMismatch(false);
    const several = balanceMismatch(false, ["bank-aug.xls", "bank-sep.xls"]);
    expect(several.fileNames).toEqual(["bank-aug.xls", "bank-sep.xls"]);
    expect(several.fix).toBe(misread.fix);
    expect(several.agent?.goal).toBe(misread.agent?.goal);
  });

  it("offers to remove a duplicate upload without an agent", () => {
    const [problem] = describeProblems(
      refused(422, {
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
      }),
    );
    expect(problem.facts).toEqual([]);
    expect(problem.agent).toBeNull();
    expect(problem.actions).toEqual([
      expect.objectContaining({
        kind: "remove-files",
        fileNames: ["bank-aug-copy.xls"],
      }),
    ]);
  });

  it("puts a problem under the last of its files in the list, and points its other files there", () => {
    const problem = balanceMismatch(false, [
      "bank-aug.xls",
      "bank-aug-copy.xls",
    ]);
    const placed = placeProblems(
      [problem],
      ["bank-aug-copy.xls", "notes.txt", "bank-aug.xls"],
    );
    expect([...placed.under.keys()]).toEqual(["bank-aug.xls"]);
    expect(placed.apart).toEqual([]);
    const other = describeFileStatus(
      { ...resolvedRow, file_name: "bank-aug-copy.xls" },
      {
        importedFiles: new Set(),
        failed: {
          files: new Set(problem.fileNames),
          tone: problem.tone,
          host: "bank-aug.xls",
        },
      },
    );
    expect(other.tone).toBe("problem");
    expect(other.text).toContain("bank-aug.xls");

    // A problem none of whose files is in the list stands apart.
    const [lost] = describeProblems({ kind: "network", message: "offline" });
    expect(placeProblems([lost], ["bank-aug.xls"]).apart).toEqual([lost]);
  });

  it("describes a gap between statements and lets the user import the earlier one alone", () => {
    const [problem] = describeProblems(
      refused(422, {
        ...PAYLOADS.statement_boundary_mismatch,
        files: [],
        failed_group: {
          ...failedGroup,
          file_names: ["bank-jul.xls", "bank-sep.xls"],
        },
      }),
    );
    expect(problem.tone).toBe("problem");
    expect(factValues(problem)).toEqual([
      formatMoney(2500),
      formatMoney(4000),
      formatMoney(1500),
    ]);
    expect(problem.actions).toEqual([
      expect.objectContaining({
        kind: "keep-only-files",
        fileNames: ["bank-jul.xls"],
      }),
    ]);
    const prompt = problem.agent?.prompt;
    expect(prompt).toContain("bank-jul.xls");
    expect(prompt).toContain("bank-sep.xls");
    expect(prompt).toMatch(/\b2500\b/);
    expect(prompt).toMatch(/\b4000\b/);
  });

  it("explains a reconciliation mismatch in terms of the last confirmed balance", () => {
    const [problem] = describeProblems(
      refused(422, {
        ...PAYLOADS.reconciliation_match_failed,
        files: [resolvedRow],
        failed_group: failedGroup,
      }),
    );
    // It reads whole without Details: the balance and day are in it.
    expect(problem.context).toContain(formatMoney(2500));
    expect(problem.context).toContain(formatDate("2026-08-31"));
    const prompt = problem.agent?.prompt;
    expect(prompt).toContain("Sample Bank");
    expect(prompt).toMatch(/\b2500\b/);
    expect(prompt).toContain("2026-08-31");
  });

  it("removes the already-imported files after a partial failure", () => {
    const error = refused(400, {
      error: "closing_balance_unavailable",
      message: "Closing balance required ...",
      files: [resolvedRow],
      failed_group: {
        preset_name: "Sample Card",
        base_account: "Sample Card",
        is_credit_card: true,
        file_names: ["card-aug.xls"],
      },
      imported_groups: [importedGroup({ file_names: ["bank-aug.xls"] })],
      partial_import: 'Sample Bank imported before "Sample Card" failed.',
    });
    // The summary says which account came in and which didn't, and that the
    // imported file is off the list.
    const summary = describeBatch({ kind: "failed", failure: error });
    expect(summary.tone).toBe("attention");
    expect(summary.text).toContain("Sample Bank");
    expect(summary.text).toContain("Sample Card");
    expect(summary.next).toContain("bank-aug.xls");
    const [problem] = describeProblems(error);
    expect(problem).toMatchObject({
      subject: "Sample Card",
      fileNames: ["card-aug.xls"],
      actions: [],
    });
    expect(problem.agent?.prompt).toContain("closing_balance_unavailable");
  });

  it("points to Accounts and the preset when the ledger lacks the preset's account", () => {
    const [problem] = describeProblems(
      refused(422, {
        ...PAYLOADS.import_account_not_found,
        files: [],
        failed_group: failedGroup,
      }),
    );
    expect(problem).toMatchObject({
      subject: "Sample Bank",
      fileNames: ["bank-aug.xls"],
    });
    expect(problem.fix).toContain("Sample Bank");
    expect(problem.actions).toEqual([
      expect.objectContaining({ kind: "link", to: "/accounts" }),
    ]);
    const prompt = problem.agent?.prompt;
    expect(prompt).toContain("import-presets.json");
    expect(prompt).toContain("base_account");
  });

  it("gives the codes without a problem of their own one shared problem and a full-payload prompt", () => {
    const codes = [
      "ambiguous_duplicate",
      "abacus_json_parse_failed",
      "categorization_config_error",
    ] as const;
    const problems = codes.map((code) => {
      const [problem] = describeProblems(
        refused(422, {
          ...PAYLOADS[code],
          files: [],
          failed_group: failedGroup,
        }),
      );
      expect(problem.subject, code).toBe("Sample Bank");
      expect(problem.context, code).toContain(PAYLOADS[code].message);
      expect(problem.agent?.prompt, code).toContain(`"error": "${code}"`);
      return problem;
    });
    expect(new Set(problems.map((problem) => problem.title)).size).toBe(1);
    expect(new Set(problems.map((problem) => problem.agent?.goal)).size).toBe(
      1,
    );
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
    expect(problem.agent).toBeNull();
    expect(problem.technical).toContain('"error": "something_new"');
    expect(describeBatch({ kind: "failed", failure: error })).toMatchObject({
      tone: "problem",
      next: null,
    });
  });

  it("explains a lost connection and a missing permission without an agent", () => {
    const [forbidden] = describeProblems(refused(403, { error: "Forbidden" }));
    expect(forbidden).toMatchObject({ fileNames: [], agent: null });
    const [network] = describeProblems({
      kind: "network",
      message: "Failed to fetch",
    });
    expect(network).toMatchObject({ fileNames: [], agent: null });
    expect(network.technical).toContain("Failed to fetch");
  });

  it("shows the figures of a running balance that drifts", () => {
    const [problem] = describeProblems(
      refused(422, {
        ...PAYLOADS.segment_balance_mismatch,
        files: [resolvedRow],
        failed_group: failedGroup,
      }),
    );
    expect(factValues(problem)).toEqual([
      formatMoney(1000),
      formatMoney(2400),
      formatMoney(2500),
      formatMoney(100),
    ]);
    // The prompt names the error the server sent and the segment's own figures.
    const prompt = problem.agent?.prompt;
    expect(prompt).toContain("segment_balance_mismatch");
    expect(prompt).toContain("2026-08-01");
    expect(prompt).toContain("2026-08-10");
    expect(prompt).toMatch(/\b2400\b/);
    expect(prompt).toMatch(/\b2500\b/);
  });
});

describe("problem tones", () => {
  const failedGroup = {
    preset_name: "Sample Bank",
    base_account: "Sample Bank",
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
      "import_account_not_found",
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
          saved_path: staged("notes.html"),
          candidate_parser_paths: [],
        },
        {
          status: "ambiguous",
          file_name: "bank.csv",
          saved_path: staged("bank.csv"),
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
          saved_path: staged(`${reason}.xls`),
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
});

/** A body for every statement import error code, as the server sends it. */
const PAYLOADS: {
  [Code in StatementImportErrorCode]: Extract<
    StatementImportError,
    { error: Code }
  >;
} = {
  import_account_not_found: {
    error: "import_account_not_found",
    message: "The ledger has no account named Sample Bank.",
    hint: "Name the account exactly as Accounts lists it, or add it there first.",
  },
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

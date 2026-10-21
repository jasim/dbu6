import { describe, expect, it } from "vitest";
import { guideCommand } from "../../../shared/index";
import { PLAN_FIRST_RULE } from "../../agent-prompt-rules";
import {
  ambiguousPrompt,
  balanceMismatchPrompt,
  identifierRequiredPrompt,
  noAccountPrompt,
  reconciliationPrompt,
  unrecognizedPrompt,
} from "./agentPrompts";
import type { RefusalOf } from "./outcome";

/*
 * /import's tasks for the coding agent: the outcome first, the case's facts
 * with the staged files, the guides by command, and the report the user
 * reads, ending with what they do next.
 */

const STAGED = "tmp/statement-uploads/050505/NOPII-statement.pdf";

const UNRECOGNIZED = {
  status: "unrecognized" as const,
  file_name: "NOPII-statement.pdf",
  saved_path: STAGED,
  candidate_parser_paths: ["sample-bank-pdf"],
};

const AMBIGUOUS = {
  status: "ambiguous" as const,
  file_name: "NOPII-statement.pdf",
  saved_path: STAGED,
  matching_parser_paths: ["sample-bank-pdf", "sample-card-pdf"],
};

const UNRESOLVED = {
  status: "unresolved" as const,
  file_name: "NOPII-statement.pdf",
  saved_path: STAGED,
  parser_path: "sample-bank-pdf",
  account: { kind: "bank" as const, identifier: "050505000012" },
  institution: "NOPII SAMPLE BANK",
  reason: "no_institution_for_parser" as const,
  message: "no institution in the presets lists this parser",
  institution_name: null,
  candidate_account_names: [],
};

const GROUP = {
  files: [
    {
      status: "resolved" as const,
      file_name: "bank-aug.xls",
      saved_path: "tmp/statement-uploads/050505/bank-aug.xls",
      parser_path: "sample-bank-xls",
      account: null,
      institution: null,
      account_id: 12,
      account_name: "Sample Savings",
    },
  ],
  failed_group: {
    account_id: 12,
    account_name: "Sample Savings",
    base_account: "Assets:Bank:Sample Savings",
    is_credit_card: false,
    file_names: ["bank-aug.xls"],
  },
};

const BALANCE_MISMATCH: RefusalOf<"balance_mismatch"> = {
  ...GROUP,
  error: "balance_mismatch",
  message: "sample message",
  computed_final: 2400,
  statement_closing: 2500,
  difference: -100,
  tolerance: 0.005,
  suspected_gap: false,
};

const RECONCILIATION: RefusalOf<"reconciliation_match_failed"> = {
  ...GROUP,
  error: "reconciliation_match_failed",
  message: "sample message",
  checkpoint_date: "2026-07-31",
  checkpoint_balance: 1000,
};

describe("every task", () => {
  it("opens with the outcome and ends with the plan and the report", () => {
    const prompts = [
      unrecognizedPrompt(UNRECOGNIZED),
      ambiguousPrompt(AMBIGUOUS),
      noAccountPrompt(UNRESOLVED),
      balanceMismatchPrompt(BALANCE_MISMATCH),
      reconciliationPrompt(RECONCILIATION),
    ];
    for (const prompt of prompts) {
      expect(prompt).toMatch(/^Outcome: /);
      expect(prompt).toContain(PLAN_FIRST_RULE);
      expect(prompt).toMatch(
        /\n\*\*[^*]+\*\*: .*\n\*\*[^*]+\*\*: .*\n\*\*Next\*\*: /,
      );
    }
  });
});

describe("a file no parser reads", () => {
  it("has the agent write a parser and tie it to my account", () => {
    const prompt = unrecognizedPrompt(UNRECOGNIZED);
    expect(prompt).toContain(
      "Outcome: Import NOPII-statement.pdf, a statement format no saved parser recognises",
    );
    expect(prompt).toContain(`File: ${STAGED}`);
    expect(prompt).toContain("Parsers that rejected it: sample-bank-pdf");
    expect(prompt).toContain(guideCommand("parser-guide"));
    expect(prompt).toContain(
      `"Import presets" in \`${guideCommand("books")}\``,
    );
    expect(prompt).toContain("add_account");
    expect(prompt).toContain("date range, row count, opening and closing");
    expect(prompt).toContain("**Next**: drop the file at /import again.");
  });
});

describe("a file several parsers claim", () => {
  it("names the parsers and has the agent part them", () => {
    const prompt = ambiguousPrompt(AMBIGUOUS);
    expect(prompt).toContain(
      "Parsers that read it: sample-bank-pdf, sample-card-pdf",
    );
    expect(prompt).toContain(`File: ${STAGED}`);
    expect(prompt).toContain("loosen no validation");
    expect(prompt).toContain("**Next**: drop the file at /import again.");
  });
});

describe("a statement whose account isn't set up", () => {
  it("adds the institution and the account with the printed identifier", () => {
    const prompt = noAccountPrompt(UNRESOLVED);
    expect(prompt).toContain(
      "Import presets: no institution lists sample-bank-pdf",
    );
    expect(prompt).toContain("add_institution");
    expect(prompt).toContain('account_identifiers ["050505000012"]');
  });

  it("adds only the account to an institution that has none", () => {
    const prompt = noAccountPrompt({
      ...UNRESOLVED,
      reason: "institution_has_no_accounts",
      institution_name: "Sample Bank",
    });
    expect(prompt).toContain('add_account to "Sample Bank"');
    expect(prompt).not.toContain("add_institution");
  });

  it("lets the agent upload the file again by the books guide", () => {
    const prompt = noAccountPrompt(UNRESOLVED);
    expect(prompt).toContain(
      `"Reaching the app" in \`${guideCommand("books")}\``,
    );
    expect(prompt).not.toContain("curl");
  });
});

describe("a statement with no account number", () => {
  it("has the parser emit it, and never guesses one", () => {
    const prompt = identifierRequiredPrompt({
      ...UNRESOLVED,
      account: null,
      reason: "statement_account_identifier_required",
      institution_name: "Sample Bank",
      candidate_account_names: ["Sample Savings", "Sample Salary"],
    });
    expect(prompt).toContain(
      "Account identifier on the statement: none emitted",
    );
    expect(prompt).toContain("Sample Savings, Sample Salary");
    expect(prompt).toContain('"Emitted account identifier"');
    expect(prompt).toContain("Don't guess an identifier.");
    expect(prompt).toContain("050505");
  });
});

describe("an account's statements the importer refused", () => {
  it("states the account, files, parser, error and figures", () => {
    const prompt = balanceMismatchPrompt(BALANCE_MISMATCH);
    expect(prompt).toContain(
      "Outcome: Import bank-aug.xls into Sample Savings, which the importer refused because",
    );
    expect(prompt).toContain(
      "Files: tmp/statement-uploads/050505/bank-aug.xls",
    );
    expect(prompt).toContain("Parser: sample-bank-xls");
    expect(prompt).toContain("Error: balance_mismatch");
    expect(prompt).toContain("Statement closing: 2500");
    expect(prompt).toContain("never by loosening validation");
  });

  it("asks before changing my books to reconcile", () => {
    const prompt = reconciliationPrompt(RECONCILIATION);
    expect(prompt).toContain(
      "Last statement balance in the books: 1000 on 2026-07-31",
    );
    expect(prompt).toContain("**Next**: ask whether to apply it.");
  });
});

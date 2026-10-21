import { describe, expect, it } from "vitest";
import { guideCommand } from "../../shared/index";
import { addAmbiguousPrompt, addUnrecognizedPrompt } from "./agent-prompts";

/*
 * The Teach card's tasks: /add sets the account up at its Confirm card,
 * so the agent lists the parser on the bank and never adds an account.
 */

const UNRECOGNIZED = {
  status: "unrecognized" as const,
  file_name: "NOPII-statement.pdf",
  saved_path: "tmp/statement-uploads/050505/NOPII-statement.pdf",
  candidate_parser_paths: ["sample-bank-pdf"],
};

const AMBIGUOUS = {
  status: "ambiguous" as const,
  file_name: "NOPII-statement.pdf",
  saved_path: "tmp/statement-uploads/050505/NOPII-statement.pdf",
  matching_parser_paths: ["sample-bank-pdf", "sample-card-pdf"],
};

describe("a file no parser reads", () => {
  it("has the agent list the parser on the bank, and add no account", () => {
    const prompt = addUnrecognizedPrompt(UNRECOGNIZED);
    expect(prompt).toMatch(/^Outcome: Add a bank account or card from /);
    expect(prompt).toContain(`File: ${UNRECOGNIZED.saved_path}`);
    expect(prompt).toContain("Parsers that rejected it: sample-bank-pdf");
    expect(prompt).toContain(guideCommand("parser-guide"));
    expect(prompt).toContain("add_parser");
    expect(prompt).toContain("add_institution");
    expect(prompt).not.toContain("add_account");
    expect(prompt).toContain("Never add an account");
    expect(prompt).not.toContain("/import");
    expect(prompt).toContain("**Next**: drop the files at /add again.");
  });
});

describe("a file several parsers claim", () => {
  it("has the agent part the parsers, and says how the user carries on", () => {
    const prompt = addAmbiguousPrompt(AMBIGUOUS);
    expect(prompt).toContain(
      "Parsers that read it: sample-bank-pdf, sample-card-pdf",
    );
    expect(prompt).toContain(AMBIGUOUS.saved_path);
    expect(prompt).not.toContain("/import");
    expect(prompt).not.toContain("add_account");
    expect(prompt).toContain("**Next**: drop the files at /add again.");
  });
});

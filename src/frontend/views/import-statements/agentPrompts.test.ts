import { describe, expect, it } from "vitest";
import { ambiguousPrompt, unrecognizedPrompt } from "./agentPrompts";

/*
 * The prompts for a file no parser reads, or several do, worded for where
 * it was dropped: /import imports into an account the presets list, and
 * /add sets the account up at its Confirm card, so its prompt never has the
 * agent add one.
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
  it("has /import's agent tie the parser to my account", () => {
    const prompt = unrecognizedPrompt(UNRECOGNIZED);
    expect(prompt).toContain("the automatic importer at /import");
    expect(prompt).toContain("(add_account)");
    expect(prompt).toContain("I will drop the file into the importer again");
  });

  it("has /add's agent list the parser on the bank, and add no account", () => {
    const prompt = unrecognizedPrompt(UNRECOGNIZED, "add");
    expect(prompt).toContain("at\n/add, to add a bank account or card");
    expect(prompt).toContain(UNRECOGNIZED.saved_path);
    expect(prompt).toContain("(add_parser)");
    expect(prompt).toContain("(add_institution)");
    expect(prompt).not.toContain("add_account");
    expect(prompt).not.toContain("importer at /import");
    expect(prompt).toContain("Don't add an account");
    expect(prompt.trimEnd()).toMatch(/I'll drop the files at \/add again\.$/);
  });
});

describe("a file several parsers claim", () => {
  it("says where it was dropped, and how the user carries on", () => {
    expect(ambiguousPrompt(AMBIGUOUS)).toContain("screen /import");
    const prompt = ambiguousPrompt(AMBIGUOUS, "add");
    expect(prompt).toContain("sample-bank-pdf, sample-card-pdf");
    expect(prompt).not.toContain("screen /import");
    expect(prompt).not.toContain("add_account");
    expect(prompt.trimEnd()).toMatch(/I'll drop the files at \/add again\.$/);
  });
});

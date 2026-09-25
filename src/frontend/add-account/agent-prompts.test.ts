import { describe, expect, it } from "vitest";
import { addAmbiguousPrompt, addUnrecognizedPrompt } from "./agent-prompts";

/*
 * The Teach card's prompts: /add sets the account up at its Confirm card,
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
    expect(prompt).toContain("at\n/add, to add a bank account or card");
    expect(prompt).toContain(UNRECOGNIZED.saved_path);
    expect(prompt).toContain("rejected the file were: sample-bank-pdf.");
    expect(prompt).toContain("(add_parser)");
    expect(prompt).toContain("(add_institution)");
    expect(prompt).not.toContain("add_account");
    expect(prompt).not.toContain("importer at /import");
    expect(prompt).toContain("Don't add an account");
    expect(prompt.trimEnd()).toMatch(/I'll drop the files at \/add again\.$/);
  });
});

describe("a file several parsers claim", () => {
  it("has the agent part the parsers, and says how the user carries on", () => {
    const prompt = addAmbiguousPrompt(AMBIGUOUS);
    expect(prompt).toContain("sample-bank-pdf, sample-card-pdf");
    expect(prompt).toContain(AMBIGUOUS.saved_path);
    expect(prompt).not.toContain("screen /import");
    expect(prompt).not.toContain("add_account");
    expect(prompt.trimEnd()).toMatch(/I'll drop the files at \/add again\.$/);
  });
});

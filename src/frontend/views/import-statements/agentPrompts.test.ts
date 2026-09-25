import { describe, expect, it } from "vitest";
import { ambiguousPrompt, unrecognizedPrompt } from "./agentPrompts";

/*
 * The prompts for a file no parser reads, or several do, dropped at
 * /import: the agent ties the parser to an account the presets list.
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
  it("has the agent tie the parser to my account", () => {
    const prompt = unrecognizedPrompt(UNRECOGNIZED);
    expect(prompt).toContain("the automatic importer at /import");
    expect(prompt).toContain(UNRECOGNIZED.saved_path);
    expect(prompt).toContain("rejected the file were: sample-bank-pdf.");
    expect(prompt).toContain("(add_account)");
    expect(prompt).toContain("I will drop the file into the importer again");
  });
});

describe("a file several parsers claim", () => {
  it("says where it was dropped, and how the user carries on", () => {
    const prompt = ambiguousPrompt(AMBIGUOUS);
    expect(prompt).toContain("screen /import");
    expect(prompt).toContain("sample-bank-pdf, sample-card-pdf");
    expect(prompt).toContain(AMBIGUOUS.saved_path);
    expect(prompt.trimEnd()).toMatch(/I will retry the import\.$/);
  });
});

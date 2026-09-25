import { describe, expect, it } from "vitest";
import { guideCommand } from "../../../shared/index";
import { sampleAmbiguousPrompt, sampleParserPrompt } from "./agentPrompts";

const SAVINGS = {
  account_id: 8,
  name: "Sample Savings",
  kind: "bank" as const,
  institution: "Sample Bank",
  account_identifiers: [],
};

describe("the setup wizard's prompts", () => {
  it("name the account, its institution and the staged sample", () => {
    const prompt = sampleParserPrompt(SAVINGS, {
      saved_path: "tmp/statement-uploads/setup-sample-8/NOPII.pdf",
      tried: [],
    });

    expect(prompt).toContain('"Sample Savings"');
    expect(prompt).toContain("account_id 8 in the import presets");
    expect(prompt).toContain(
      "at tmp/statement-uploads/setup-sample-8/NOPII.pdf",
    );
    expect(prompt).toContain(
      'add it to\n   the institution "Sample Bank" by its directory name (add_parser)',
    );
    // With no number given, the parser's identifier becomes the account's.
    expect(prompt).toContain("update_account with account_id 8");
    expect(prompt).toContain(guideCommand("parser-guide"));
    expect(prompt).toContain("There is no saved parser at all");
  });

  it("compare the number given with the one the parser emits", () => {
    const prompt = sampleParserPrompt(
      { ...SAVINGS, account_identifiers: ["050505000012"] },
      { saved_path: "tmp/NOPII.pdf", tried: null },
    );
    expect(prompt).toContain(
      "Check that the identifier the parser emits is 050505000012.",
    );
    expect(prompt).not.toContain("The parsers it tried");
  });

  it("ask for the fingerprints to be parted when two parsers claim a sample", () => {
    const prompt = sampleAmbiguousPrompt(SAVINGS, {
      saved_path: "tmp/NOPII.pdf",
      parsers: ["sample-a", "sample-b"],
    });
    expect(prompt).toContain("sample-a, sample-b");
    expect(prompt).toContain("Tighten the fingerprints");
  });
});

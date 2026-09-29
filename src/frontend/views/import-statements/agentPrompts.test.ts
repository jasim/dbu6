import { describe, expect, it } from "vitest";
import {
  ambiguousPrompt,
  noAccountPrompt,
  unrecognizedPrompt,
} from "./agentPrompts";

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

const UNRESOLVED = {
  status: "unresolved" as const,
  file_name: "NOPII-statement.pdf",
  saved_path: "tmp/statement-uploads/050505/NOPII-statement.pdf",
  parser_path: "sample-bank-pdf",
  account: { kind: "bank" as const, identifier: "050505000012" },
  institution: "NOPII SAMPLE BANK",
  reason: "no_institution_for_parser" as const,
  message: "no institution in the presets lists this parser",
  institution_name: null,
  candidate_account_names: [],
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

describe("a prompt that lets the agent re-run the import", () => {
  it("takes the token from the project, not from my account page", () => {
    const prompt = noAccountPrompt(UNRESOLVED, "http://localhost:2345");

    expect(prompt).toContain("npx dbu6 agent env");
    expect(prompt).toContain(".env.agent");
    expect(prompt).toContain("set -a; . ./.env.agent; set +a");
    expect(prompt).not.toContain("account page");
  });

  it("posts to the origin the screen was served from", () => {
    const prompt = noAccountPrompt(UNRESOLVED, "http://localhost:2340");

    expect(prompt).toContain(
      'curl -sS -X POST "http://localhost:2340/api/import-draft/statements/auto"',
    );
    expect(prompt).not.toContain("$SAPPORTA_API_URL");
  });
});

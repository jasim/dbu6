import { describe, expect, it } from "vitest";
import { describeCategorizationProblem } from "./describeCategorization";

describe("describeCategorizationProblem", () => {
  it("says nothing when every call answered, or nothing was sent", () => {
    expect(
      describeCategorizationProblem({
        engine: "claude-code",
        sent_count: 12,
        failed_count: 0,
        error: null,
      }),
    ).toBeNull();
    expect(
      describeCategorizationProblem({
        engine: "nuabase",
        sent_count: 0,
        failed_count: 0,
        error: null,
      }),
    ).toBeNull();
  });

  it("counts the descriptions a failed call left out, and why", () => {
    expect(
      describeCategorizationProblem({
        engine: "claude-code",
        sent_count: 120,
        failed_count: 50,
        error: "claude-code timed out after 180000 ms",
      }),
    ).toEqual({
      text: "Couldn't categorize 50 of 120 descriptions with Claude Code",
      reason: "claude-code timed out after 180000 ms",
    });
  });

  it("says when none could be categorized", () => {
    expect(
      describeCategorizationProblem({
        engine: "nuabase",
        sent_count: 12,
        failed_count: 12,
        error: "NUABASE_API_KEY is not set",
      }),
    ).toEqual({
      text: "Couldn't categorize any of the 12 descriptions with Nuabase",
      reason: "NUABASE_API_KEY is not set",
    });
    expect(
      describeCategorizationProblem({
        engine: "codex",
        sent_count: 1,
        failed_count: 1,
        error: null,
      }),
    ).toEqual({
      text: "Couldn't categorize the 1 description with Codex",
      reason: "No reason was given.",
    });
  });

  it("names no engine when no coding agent is installed", () => {
    expect(
      describeCategorizationProblem({
        engine: null,
        sent_count: 12,
        failed_count: 12,
        error:
          "No coding agent found. Install Claude Code or Codex on the machine running dbu6.",
      }),
    ).toEqual({
      text: "Couldn't categorize any of the 12 descriptions",
      reason:
        "No coding agent found. Install Claude Code or Codex on the machine running dbu6.",
    });
  });
});

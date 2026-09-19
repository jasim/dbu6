import { describe, expect, it } from "vitest";
import {
  categorizationCounts,
  describeCategorizationProblem,
} from "./describeCategorization";

describe("describeCategorizationProblem", () => {
  it("says nothing when every call answered, or nothing was sent", () => {
    expect(
      describeCategorizationProblem({
        agent: "claude-code",
        sent_count: 12,
        failed_count: 0,
        error: null,
      }),
    ).toBeNull();
    expect(
      describeCategorizationProblem({
        agent: "claude-code",
        sent_count: 0,
        failed_count: 0,
        error: null,
      }),
    ).toBeNull();
  });

  it("says the agent couldn't categorize some of them when some calls failed, and why", () => {
    expect(
      describeCategorizationProblem({
        agent: "claude-code",
        sent_count: 120,
        failed_count: 50,
        error: "claude-code timed out after 180000 ms",
      }),
    ).toEqual({
      text: "Claude Code couldn't categorize some of them",
      reason: "claude-code timed out after 180000 ms",
    });
  });

  it("says the agent couldn't categorize them when none could be", () => {
    expect(
      describeCategorizationProblem({
        agent: "claude-code",
        sent_count: 12,
        failed_count: 12,
        error: "Not logged in",
      }),
    ).toEqual({
      text: "Claude Code couldn't categorize them",
      reason: "Not logged in",
    });
    expect(
      describeCategorizationProblem({
        agent: "codex",
        sent_count: 1,
        failed_count: 1,
        error: null,
      }),
    ).toEqual({
      text: "Codex couldn't categorize them",
      reason: "No reason was given.",
    });
  });

  it("names no agent when categorization ran on none", () => {
    expect(
      describeCategorizationProblem({
        agent: null,
        sent_count: 12,
        failed_count: 12,
        error:
          "No coding agent found. Install Claude Code or Codex on the machine running dbu6.",
      }),
    ).toEqual({
      text: "Couldn't categorize them automatically",
      reason:
        "No coding agent found. Install Claude Code or Codex on the machine running dbu6.",
    });
  });
});

describe("categorizationCounts", () => {
  it("counts the rules' and the LLM's as categorized, and the rest as remaining", () => {
    expect(
      categorizationCounts({
        by_rule: 9,
        by_llm: 3,
        same_account: 1,
        uncategorized: 4,
        accounts: [],
      }),
    ).toEqual({ categorized: 12, remaining: 5 });
  });
});

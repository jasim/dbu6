import { describe, expect, it } from "vitest";
import {
  describeCategorizationProblem,
  describeCategorizationTally,
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

  it("counts the descriptions a failed call left out, and why", () => {
    expect(
      describeCategorizationProblem({
        agent: "claude-code",
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
        agent: "claude-code",
        sent_count: 12,
        failed_count: 12,
        error: "Not logged in",
      }),
    ).toEqual({
      text: "Couldn't categorize any of the 12 descriptions with Claude Code",
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
      text: "Couldn't categorize the 1 description with Codex",
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
      text: "Couldn't categorize any of the 12 descriptions",
      reason:
        "No coding agent found. Install Claude Code or Codex on the machine running dbu6.",
    });
  });
});

describe("describeCategorizationTally", () => {
  const none = {
    by_rule: 0,
    by_llm: 0,
    same_account: 0,
    uncategorized: 0,
    accounts: [],
  };

  it("counts what the rules and the agent categorized, and what remains", () => {
    expect(
      describeCategorizationTally(
        { ...none, by_rule: 9, by_llm: 3, uncategorized: 4 },
        "claude-code",
      ),
    ).toEqual({
      text: "Categorized 12 (9 by your rules, 3 by Claude Code).",
      remain: "4 remain",
      sameAccount: null,
    });
  });

  it("names only who categorized anything, and nothing remaining", () => {
    expect(
      describeCategorizationTally({ ...none, by_rule: 5 }, "claude-code"),
    ).toEqual({
      text: "Categorized 5 by your rules.",
      remain: null,
      sameAccount: null,
    });
    expect(
      describeCategorizationTally({ ...none, by_llm: 1 }, "codex"),
    ).toEqual({
      text: "Categorized 1 by Codex.",
      remain: null,
      sameAccount: null,
    });
    expect(describeCategorizationTally({ ...none, by_llm: 2 }, null)).toEqual({
      text: "Categorized 2 by the LLM.",
      remain: null,
      sameAccount: null,
    });
  });

  it("counts the rows answered with the statement's own account among those remaining", () => {
    expect(
      describeCategorizationTally(
        { ...none, same_account: 1, uncategorized: 2 },
        "claude-code",
      ),
    ).toEqual({
      text: "Categorized none.",
      remain: "3 remain",
      sameAccount:
        "1 of them was matched to the statement's own account, which can't be the other side of its entry.",
    });
    expect(
      describeCategorizationTally(
        { ...none, by_rule: 1, same_account: 2 },
        "claude-code",
      ),
    ).toMatchObject({
      remain: "2 remain",
      sameAccount:
        "2 of them were matched to the statement's own account, which can't be the other side of their entry.",
    });
    expect(
      describeCategorizationTally({ ...none, uncategorized: 1 }, "claude-code"),
    ).toMatchObject({ remain: "1 remains" });
  });

  it("says nothing when there was nothing to categorize", () => {
    expect(describeCategorizationTally(none, "claude-code")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { AddProgress, LlmStatus } from "../../shared/index";
import { elapsed, importingSteps } from "./importing-steps";

const AGENT: LlmStatus = { ready: true, name: "Sample Agent" };
const NO_AGENT: LlmStatus = {
  ready: false,
  name: "no coding agent",
  reason: "No coding agent is installed.",
};

const steps = (progress: AddProgress | null, categorizer: LlmStatus = AGENT) =>
  importingSteps(progress, categorizer).map((step) =>
    [step.label, step.state, step.detail].filter(Boolean).join(" · "),
  );

describe("the importing card's steps", () => {
  it("sets the account up before the server says more", () => {
    expect(steps(null)).toEqual([
      "Set up the account · running",
      "Apply your rules · waiting",
      "Ask Sample Agent · waiting",
      "Save as drafts · waiting",
    ]);
  });

  it("asks the agent about what the rules left, answer by answer", () => {
    expect(
      steps({
        stage: "llm",
        rules: { transactions: 40, matched: 10 },
        llm: { descriptions: 25, answered: 20 },
      }),
    ).toEqual([
      "Set up the account · done",
      "Apply your rules · done · 10 of 40 categorized",
      "Ask Sample Agent · running · 20 of 25 descriptions answered",
      "Save as drafts · waiting",
    ]);
  });

  it("asks nothing when the rules answered every row", () => {
    expect(
      steps({
        stage: "rules",
        rules: { transactions: 40, matched: 40 },
        llm: null,
      }),
    ).toEqual([
      "Set up the account · done",
      "Apply your rules · done · 40 of 40 categorized",
      "Ask Sample Agent · done · Nothing left to ask",
      "Save as drafts · running",
    ]);
  });

  it("leaves the agent out when there is none", () => {
    expect(
      steps(
        { stage: "saving", rules: { transactions: 4, matched: 1 }, llm: null },
        NO_AGENT,
      ),
    ).toEqual([
      "Set up the account · done",
      "Apply your rules · done · 1 of 4 categorized",
      "Save as drafts · running",
    ]);
  });

  it("counts the time in minutes and seconds", () => {
    expect(elapsed(7.9)).toBe("0:07");
    expect(elapsed(102)).toBe("1:42");
    expect(elapsed(725)).toBe("12:05");
  });
});

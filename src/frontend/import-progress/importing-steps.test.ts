import { describe, expect, it } from "vitest";
import type { ImportProgressReport, LlmStatus } from "../../shared/index";
import { elapsed, importingSteps } from "./importing-steps";

const AGENT: LlmStatus = { ready: true, name: "Sample Agent" };
const NO_AGENT: LlmStatus = {
  ready: false,
  name: "no coding agent",
  reason: "No coding agent is installed.",
};

// Rows the rules answered, then rows they left.
const rows = (transactions: number, matched: number) =>
  Array.from({ length: transactions }, (_, index) => ({
    date: "2026-08-01",
    narration: "SAMPLE PAYEE",
    amount: 100,
    direction: "out" as const,
    account: index < matched ? "Food" : null,
    by: index < matched ? ("rule" as const) : null,
  }));

const steps = (
  progress: ImportProgressReport | null,
  categorizer: LlmStatus = AGENT,
) =>
  importingSteps(progress, categorizer).map((step) =>
    [step.label, step.state, step.detail].filter(Boolean).join(" · "),
  );

describe("the importing steps", () => {
  it("sets the account up before the server says more", () => {
    expect(steps(null)).toEqual([
      "Set up the account · running",
      "Apply your rules · waiting",
      "Ask Sample Agent · waiting",
      "Save as drafts · waiting",
    ]);
  });

  it("asks the agent about what the rules left", () => {
    expect(
      steps({
        stage: "llm",
        rows: rows(40, 10),
      }),
    ).toEqual([
      "Set up the account · done",
      "Apply your rules · done · 10 of 40 categorized",
      "Ask Sample Agent · running",
      "Save as drafts · waiting",
    ]);
  });

  it("asks nothing when the rules answered every row", () => {
    expect(
      steps({
        stage: "rules",
        rows: rows(40, 40),
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
        {
          stage: "saving",
          rows: rows(4, 1),
        },
        NO_AGENT,
      ),
    ).toEqual([
      "Set up the account · done",
      "Apply your rules · done · 1 of 4 categorized",
      "Save as drafts · running",
    ]);
  });

  it("ticks every step once the add has answered", () => {
    expect(
      steps({
        stage: "done",
        rows: rows(4, 1),
      }),
    ).toEqual([
      "Set up the account · done",
      "Apply your rules · done · 1 of 4 categorized",
      "Ask Sample Agent · done",
      "Save as drafts · done",
    ]);
  });

  it("counts the time in minutes and seconds", () => {
    expect(elapsed(7.9)).toBe("0:07");
    expect(elapsed(102)).toBe("1:42");
    expect(elapsed(725)).toBe("12:05");
  });
});

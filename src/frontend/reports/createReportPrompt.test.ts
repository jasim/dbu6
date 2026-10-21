import { describe, expect, it } from "vitest";
import { PLAN_FIRST_RULE } from "../agent-prompt-rules";
import { createReportPrompt } from "./createReportPrompt";

const prompt = createReportPrompt("  Spending by weekday, for any period  ", [
  "balance-sheet",
  "net-worth",
]);

describe("the Create a report prompt", () => {
  it("opens with the outcome, then the user's words and the ids already taken", () => {
    expect(prompt).toMatch(/^Outcome: Add a report to my books/);
    expect(prompt).toContain('"""\nSpending by weekday, for any period\n"""');
    expect(prompt).toContain(
      "Report ids already taken: balance-sheet, net-worth",
    );
  });

  it("leaves how to write it to the reports guide, named by its command", () => {
    expect(prompt).toContain("`npx dbu6 docs reports`");
    // A prompt names a command, never a file inside the installed package.
    expect(prompt).not.toMatch(/node_modules\/|docs\/reports-guide\.md/);
  });

  it("ends with the plan-first rule and a report on how to open and check it", () => {
    expect(prompt).toContain(PLAN_FIRST_RULE);
    expect(prompt).toContain("**Where to find it**: what to restart");
    expect(prompt).toMatch(/\n\*\*Check\*\*: whether `npx dbu6 check` passes\.$/);
  });
});

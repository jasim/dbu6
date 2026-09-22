import { describe, expect, it } from "vitest";
import { planFirst, PLAN_FIRST_RULE } from "../agent-prompt-rules";
import { createReportPrompt } from "./createReportPrompt";

const prompt = createReportPrompt("  Spending by weekday, for any period  ", [
  "balance-sheet",
  "net-worth",
]);

describe("the Create a report prompt", () => {
  it("carries the user's words and the ids already taken", () => {
    expect(prompt).toContain('"""\nSpending by weekday, for any period\n"""');
    expect(prompt).toContain("balance-sheet, net-worth");
  });

  it("names the guide by its command and keeps the work in the project", () => {
    expect(prompt).toContain("`dbu6 docs reports`");
    expect(prompt).toContain("reports/<id>/");
    expect(prompt).toContain("never edit anything under node_modules");
    expect(prompt).toContain("reportLedger");
    // A prompt names a command, never a file inside the installed package.
    expect(prompt).not.toMatch(/node_modules\/|docs\/reports-guide\.md/);
  });

  it("reaches the agent under the plan-first rule", () => {
    expect(planFirst(prompt).startsWith(PLAN_FIRST_RULE)).toBe(true);
  });
});

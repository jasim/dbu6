import { describe, expect, it } from "vitest";
import { PLAN_FIRST_RULE } from "../../agent-prompt-rules";
import {
  FREEFORM_TRANSACTIONS_GUIDE,
  freeformTransactionsPrompt,
} from "./freeformTransactionsPrompt";

describe("freeformTransactionsPrompt", () => {
  it("names the kind, the account, and the guide", () => {
    const prompt = freeformTransactionsPrompt({
      kind: "card",
      name: "Sample Credit Card",
    });
    expect(prompt).toMatch(/^Outcome: Import my credit card transactions/);
    expect(prompt).toContain(
      "Ledger account: Sample Credit Card\nKind: credit card",
    );
    // The guide is inside the installed package: the prompt names the
    // command that prints it, not a file.
    expect(FREEFORM_TRANSACTIONS_GUIDE).toBe("npx dbu6 docs freeform-guide");
    expect(prompt).toContain(`\`${FREEFORM_TRANSACTIONS_GUIDE}\``);
    expect(prompt).not.toContain(".md");

    expect(
      freeformTransactionsPrompt({ kind: "bank", name: "Sample Bank" }),
    ).toContain("Kind: bank account");
  });

  it("asks for both balances before importing", () => {
    const prompt = freeformTransactionsPrompt({
      kind: "bank",
      name: "Sample Bank",
    });
    expect(prompt).toContain(
      "Don't import until I've given you\nthe opening and closing balances.",
    );
  });

  it("ends on the line the pasted transactions follow, after the plan and report rules", () => {
    const prompt = freeformTransactionsPrompt({
      kind: "bank",
      name: "Sample Bank",
    });
    const rules = prompt.indexOf(PLAN_FIRST_RULE);
    const follow = prompt.indexOf("My transactions follow");
    expect(rules).toBeGreaterThan(0);
    expect(follow).toBeGreaterThan(prompt.indexOf("**Next**: check them in Review."));
    expect(prompt.endsWith("once I say go.\n")).toBe(true);
  });
});

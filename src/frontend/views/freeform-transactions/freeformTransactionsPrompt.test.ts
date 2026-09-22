import { describe, expect, it } from "vitest";
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
    expect(prompt).toContain(
      "I have transactions from a credit card in freeform",
    );
    expect(prompt).toContain(
      "They go into the ledger account Sample Credit Card.",
    );
    // The guide is inside the installed package: the prompt names the
    // command that prints it, not a file.
    expect(FREEFORM_TRANSACTIONS_GUIDE).toBe("dbu6 docs freeform-guide");
    expect(prompt).toContain(`\`${FREEFORM_TRANSACTIONS_GUIDE}\``);
    expect(prompt).not.toContain(".md");

    expect(
      freeformTransactionsPrompt({ kind: "bank", name: "Sample Bank" }),
    ).toContain("I have transactions from a bank account in freeform");
  });

  it("always asks for both balances before importing", () => {
    const prompt = freeformTransactionsPrompt({
      kind: "bank",
      name: "Sample Bank",
    });
    expect(prompt).toContain("ask me for the opening balance");
    expect(prompt).toContain("the closing balance");
    expect(prompt).toContain("Do not import without both.");
  });
});

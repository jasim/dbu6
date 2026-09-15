import { describe, expect, it } from "vitest";
import {
  FREEFORM_TRANSACTIONS_GUIDE,
  freeformTransactionsPrompt,
} from "./freeformTransactionsPrompt";

describe("freeformTransactionsPrompt", () => {
  it("names the kind, the account, and the guide", () => {
    const prompt = freeformTransactionsPrompt({
      kind: "card",
      name: "cc:sample",
    });
    expect(prompt).toContain(
      "I have transactions from a credit card in freeform",
    );
    expect(prompt).toContain("They go into the ledger account cc:sample.");
    expect(prompt).toContain(FREEFORM_TRANSACTIONS_GUIDE);

    expect(
      freeformTransactionsPrompt({ kind: "bank", name: "assets:bank:sample" }),
    ).toContain("I have transactions from a bank account in freeform");
  });

  it("always asks for both balances before importing", () => {
    const prompt = freeformTransactionsPrompt({
      kind: "bank",
      name: "assets:bank:sample",
    });
    expect(prompt).toContain("ask me for the opening balance");
    expect(prompt).toContain("the closing balance");
    expect(prompt).toContain("Do not import without both.");
  });
});

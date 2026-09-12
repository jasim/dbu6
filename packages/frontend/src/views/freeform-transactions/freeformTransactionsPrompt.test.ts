import { describe, expect, it } from "vitest";
import type { ImportPreset } from "dbu6-shared";
import {
  FREEFORM_TRANSACTIONS_GUIDE,
  freeformTransactionsPrompt,
} from "./freeformTransactionsPrompt";

const card: ImportPreset = {
  name: "Sample Card",
  base_account: "liabilities:card:sample",
  custom_mappings_filenames: [],
  is_credit_card: true,
};

describe("freeformTransactionsPrompt", () => {
  it("names the bank, the preset, and the guide", () => {
    const prompt = freeformTransactionsPrompt({
      bankName: "  Sample Bank ",
      preset: card,
    });
    expect(prompt).toContain(
      "I have transactions from Sample Bank in freeform",
    );
    expect(prompt).toContain(
      'the import preset "Sample Card" in data/user-config/import-presets.json (ledger account liabilities:card:sample, a credit card).',
    );
    expect(prompt).toContain(FREEFORM_TRANSACTIONS_GUIDE);
  });

  it("always asks for both balances before importing", () => {
    for (const preset of [card, null]) {
      const prompt = freeformTransactionsPrompt({
        bankName: "Sample Bank",
        preset,
      });
      expect(prompt).toContain("ask me for the opening balance");
      expect(prompt).toContain("the closing balance");
      expect(prompt).toContain("Do not import without both.");
    }
  });

  it("asks the agent to set up a preset when the account has none", () => {
    const prompt = freeformTransactionsPrompt({
      bankName: "Sample Bank",
      preset: null,
    });
    expect(prompt).toContain("an account that has no import preset yet");
    expect(prompt).not.toContain("ledger account");
  });

  it("leaves a bank account's kind unstated", () => {
    const prompt = freeformTransactionsPrompt({
      bankName: "Sample Bank",
      preset: {
        ...card,
        base_account: "assets:bank:sample",
        is_credit_card: false,
      },
    });
    expect(prompt).toContain("(ledger account assets:bank:sample).");
  });
});

import type { ImportPreset } from "dbu6-shared";

// The prompt the Import freeform transactions screen hands to a coding agent.
// How to read the transactions, what to ask the user, the request shape, and
// how to call the import all live in the guide the prompt points at. The
// prompt carries only what the screen knows: the bank, and the preset the
// rows go into.

export const FREEFORM_TRANSACTIONS_GUIDE =
  "custom-built-parsers/freeform-transactions-guide.md";

export function freeformTransactionsPrompt(input: {
  bankName: string;
  // Null when the account has no import preset yet.
  preset: ImportPreset | null;
}): string {
  const bank = input.bankName.trim();
  const account =
    input.preset === null
      ? "an account that has no import preset yet. Set one up first, as the guide describes."
      : `the import preset "${input.preset.name}" in data/user-config/import-presets.json (ledger account ${input.preset.base_account}${input.preset.is_credit_card ? ", a credit card" : ""}).`;
  return `I have transactions from ${bank} in freeform: no saved statement parser reads them. Import them into Drafts in this repository, following ${FREEFORM_TRANSACTIONS_GUIDE} exactly.

The transactions belong to ${account}

Before you import anything, ask me for the opening balance (just before the earliest transaction) and the closing balance (just after the latest one). Do not import without both.

When the import finishes, show me the result from the API response.

The transactions follow, as I have them. If nothing follows, ask me for them.
`;
}

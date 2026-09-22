// The prompt the Import freeform transactions screen hands to a coding agent.
// How to read the transactions, what to ask the user, the request shape, and
// how to call the import all live in the guide the prompt points at. The
// prompt carries only what the screen knows: whether the transactions are a
// bank account's or a credit card's, and the ledger account they go into.

import { guideCommand, type AccountKind } from "../../../shared/index";

// The guide ships inside dbu6, so the prompt names the command that prints
// it rather than a file the agent may not find.
export const FREEFORM_TRANSACTIONS_GUIDE = guideCommand("freeform-guide");

export interface FreeformAccount {
  kind: AccountKind;
  // The ledger account's name, e.g. `Sample Card`.
  name: string;
}

export function freeformTransactionsPrompt(account: FreeformAccount): string {
  const source = account.kind === "card" ? "a credit card" : "a bank account";
  return `I have transactions from ${source} in freeform: no saved statement parser reads them. Import them into Drafts in my books app (this project). Run \`${FREEFORM_TRANSACTIONS_GUIDE}\` and follow the guide it prints exactly.

They go into the ledger account ${account.name}.

Before you import anything, ask me for the opening balance (just before the earliest transaction) and the closing balance (just after the latest one). Do not import without both.

When the import finishes, show me the result from the API response.

The transactions follow, as I have them. If nothing follows, ask me for them.
`;
}

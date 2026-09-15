// The prompt the Import freeform transactions screen hands to a coding agent.
// How to read the transactions, what to ask the user, the request shape, and
// how to call the import all live in the guide the prompt points at. The
// prompt carries only what the screen knows: whether the transactions are a
// bank account's or a credit card's, and the ledger account they go into.

import type { AccountKind } from "dbu6-shared";

export const FREEFORM_TRANSACTIONS_GUIDE =
  "custom-built-parsers/freeform-transactions-guide.md";

export interface FreeformAccount {
  kind: AccountKind;
  // The ledger account's full name, e.g. `cc:sample`.
  name: string;
}

export function freeformTransactionsPrompt(account: FreeformAccount): string {
  const source = account.kind === "card" ? "a credit card" : "a bank account";
  return `I have transactions from ${source} in freeform: no saved statement parser reads them. Import them into Drafts in this repository, following ${FREEFORM_TRANSACTIONS_GUIDE} exactly.

They go into the ledger account ${account.name}.

Before you import anything, ask me for the opening balance (just before the earliest transaction) and the closing balance (just after the latest one). Do not import without both.

When the import finishes, show me the result from the API response.

The transactions follow, as I have them. If nothing follows, ask me for them.
`;
}

// The prompt the Import freeform transactions screen hands to a coding agent.
// How to read the transactions, the request shape, and how to call the import
// all live in the guide the prompt points at. The prompt carries only what the
// screen knows: whether the transactions are a bank account's or a credit
// card's, and the ledger account they go into.

import { guideCommand, type AccountKind } from "../../../shared/index";
import { agentPrompt, type AgentPrompt } from "../../agent-prompt-rules";

// The guide ships inside dbu6, so the prompt names the command that prints
// it rather than a file the agent may not find.
export const FREEFORM_TRANSACTIONS_GUIDE = guideCommand("freeform-guide");

export interface FreeformAccount {
  kind: AccountKind;
  // The ledger account's name, e.g. `Sample Card`.
  name: string;
}

export function freeformTransactionsPrompt(
  account: FreeformAccount,
): AgentPrompt {
  const source = account.kind === "card" ? "credit card" : "bank account";
  const prompt = agentPrompt({
    outcome: `Import my ${source} transactions, pasted below, as drafts in Review for ${account.name}.`,
    facts: `Ledger account: ${account.name}
Kind: ${source}`,
    how: `Follow \`${FREEFORM_TRANSACTIONS_GUIDE}\` exactly. Don't import until I've given you
the opening and closing balances.`,
    report: [
      {
        heading: "Imported",
        says: "how many drafts, their dates, and the opening and closing balances used.",
      },
      { heading: "Skipped", says: "rows left out or uncategorized, and why." },
      { heading: "Next", says: "check them in Review." },
    ],
  });
  // The user pastes the transactions after the prompt, so this line is last:
  // the data then follows the line that announces it, not the report rule.
  return `${prompt}

My transactions follow, as I have them. If nothing follows, I'll paste them
once I say go.
` as AgentPrompt;
}

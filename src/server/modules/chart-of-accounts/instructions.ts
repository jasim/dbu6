import type { ChartAccount } from "../../../shared/index.js";
import { BANK_CARD_LOAN_GROUPS } from "./starter-chart.js";

/**
 * Pure: the categorizer's first instructions, from the notes of the chart
 * being created, one line per account that has one; null when none has.
 * Left out are Equity accounts, which the categorizer never offers, a group
 * with accounts under it, and the groups banks, cards and loans are added
 * under: a statement line goes to none of them. They become
 * custom_mappings_default.prompt, which the user edits from then on; the
 * prompt reads it after "please follow the following custom mapping
 * instructions:", so it is written in the user's voice.
 */
export function chartCategorizationInstructions(
  accounts: readonly ChartAccount[],
): string | null {
  const parents = new Set(accounts.map((account) => account.parent));
  const lines = accounts.flatMap((account) =>
    account.note &&
    account.account_type !== "Equity" &&
    !parents.has(account.name) &&
    !BANK_CARD_LOAN_GROUPS.includes(account.name)
      ? [`- ${account.name}: ${account.note}`]
      : [],
  );
  if (lines.length === 0) return null;
  // Nothing after the lines: the prompt already says what to leave blank,
  // and a rule here would read as limiting the categorizer to these accounts
  // or forbid a note's own payee ("the part-time cook").
  return ["What goes to some of my accounts:", "", ...lines, ""].join("\n");
}

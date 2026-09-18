import type { JournalPlan, PlannedEntry } from "./JournalPlan.js";

/**
 * A journal plan as hledger text, by account name. The draft preview, the
 * import summary and posted journals (read back as a plan) all render here.
 *
 *   {date} {description}
 *       {account:<35} {amount:>10.2f}[ = {assertion:.2f}][ ; {comment}]
 */
export function formatHledger(plan: JournalPlan<string>): string {
  return plan
    .map((journal) =>
      [
        `${journal.date} ${journal.description}`,
        ...journal.entries.map(formatEntry),
      ].join("\n"),
    )
    .join("\n\n");
}

function formatEntry(entry: PlannedEntry<string>): string {
  const assertion =
    entry.assertion === null ? "" : ` = ${entry.assertion.toFixed(2)}`;
  const comment = entry.comment ? ` ; ${entry.comment}` : "";
  return `    ${entry.account.padEnd(35)} ${entry.amount.toFixed(2).padStart(10)}${assertion}${comment}`;
}

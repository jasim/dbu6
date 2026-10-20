import { normalizeIdentityText } from "../values/index.js";
import type { JournalPlan, PlannedEntry } from "./JournalPlan.js";

/** An account as its hledger name needs it: its own name and its parent. */
export type HledgerAccount = {
  id: number;
  name: string;
  parent_id: number | null;
};

/**
 * Each account's hledger name, by its own name: the names from the top of its
 * branch down to it, joined by colons, as `Expenses:Food:Dining Out`. The
 * branch comes from `parent_id`, never from the names. Throws on a parent
 * loop, which the database refuses.
 */
export function hledgerAccountNames(
  accounts: readonly HledgerAccount[],
): Map<string, string> {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const hledgerName = (account: HledgerAccount): string => {
    const names: string[] = [];
    const seen = new Set<number>();
    let current: HledgerAccount | undefined = account;
    while (current !== undefined) {
      if (seen.has(current.id)) {
        throw new Error(`parent_id loops through account ${current.id}`);
      }
      seen.add(current.id);
      names.unshift(current.name);
      current =
        current.parent_id === null ? undefined : byId.get(current.parent_id);
    }
    return names.join(":");
  };
  return new Map(
    accounts.map((account) => [account.name, hledgerName(account)]),
  );
}

/**
 * A journal plan as hledger text. The draft preview, the import summary and
 * posted journals (read back as a plan) all render here. Each account is
 * written by its name in the ledger, never its path down the account tree:
 * names are unique, and a person's often carry their parent's already. An
 * entry's comment follows it, unless it only repeats the description,
 * and its source narration after that in parentheses, so an export keeps the
 * statement's text: where there is no comment, or where the comment says
 * something else (`sayTheSame`); never when it only repeats the description.
 *
 *   {date} {description}
 *       {account:<35} {amount:>10.2f}[ = {assertion:.2f}][ ; {comment}][ ({source narration})]
 */
export function formatHledger(plan: JournalPlan<string>): string {
  return plan
    .map((journal) =>
      [
        `${journal.date} ${journal.description}`,
        ...journal.entries.map((entry) =>
          formatEntry(entry, journal.description),
        ),
      ].join("\n"),
    )
    .join("\n\n");
}

function formatEntry(entry: PlannedEntry<string>, description: string): string {
  const { account } = entry;
  const assertion =
    entry.assertion === null ? "" : ` = ${entry.assertion.toFixed(2)}`;
  const comment = entry.comment?.trim() || null;
  const source = entry.sourceNarration?.trim() || null;
  const texts = [
    comment !== null && comment !== description ? comment : null,
    source !== null &&
    source !== description &&
    (comment === null || !sayTheSame(comment, source))
      ? `(${source})`
      : null,
  ].filter((text): text is string => text !== null);
  // hledger ends an account name at two spaces, since names hold single ones.
  return `    ${`${account} `.padEnd(35)} ${entry.amount.toFixed(2).padStart(10)}${assertion}${texts.length > 0 ? ` ; ${texts.join(" ")}` : ""}`;
}

/**
 * Whether a comment says what the statement's narration says, as one
 * rewritten from it does: at least half of the comment's words are in the
 * narration. Words are compared without case, and without digits or
 * punctuation, so a narration's reference numbers and its bank's wrapper
 * (`UPI/…/sample@ybl`) don't count against it.
 */
function sayTheSame(comment: string, narration: string): boolean {
  const commentWords = words(comment);
  const narrationWords = new Set(words(narration));
  const shared = commentWords.filter((word) => narrationWords.has(word));
  return shared.length * 2 >= commentWords.length;
}

function words(text: string): string[] {
  return normalizeIdentityText(text)
    .split(/[^\p{L}]+/u)
    .filter((word) => word !== "");
}

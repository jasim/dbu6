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
 * posted journals (read back as a plan) all render here. A plan names each
 * account by its name in the ledger, and `hledgerNames`
 * (`hledgerAccountNames`) gives the name hledger writes for it; a name the
 * ledger doesn't have, such as an answer naming no account, is written as it
 * is.
 *
 *   {date} {description}
 *       {account:<35} {amount:>10.2f}[ = {assertion:.2f}][ ; {comment}]
 */
export function formatHledger(
  plan: JournalPlan<string>,
  hledgerNames: ReadonlyMap<string, string>,
): string {
  return plan
    .map((journal) =>
      [
        `${journal.date} ${journal.description}`,
        ...journal.entries.map((entry) => formatEntry(entry, hledgerNames)),
      ].join("\n"),
    )
    .join("\n\n");
}

function formatEntry(
  entry: PlannedEntry<string>,
  hledgerNames: ReadonlyMap<string, string>,
): string {
  const account = hledgerNames.get(entry.account) ?? entry.account;
  const assertion =
    entry.assertion === null ? "" : ` = ${entry.assertion.toFixed(2)}`;
  const comment = entry.comment ? ` ; ${entry.comment}` : "";
  // hledger ends an account name at two spaces, since names hold single ones.
  return `    ${`${account} `.padEnd(35)} ${entry.amount.toFixed(2).padStart(10)}${assertion}${comment}`;
}

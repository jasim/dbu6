/*
 * Accounts form a tree through `parent_id`, and entries can sit on any account
 * in it, parents included. A report that groups accounts puts each one under
 * the top of its branch, so every entry counts exactly once however deep the
 * tree goes.
 */

export type TreeAccount = { account_id: number; parent_id: number | null };

/**
 * The top of each account's branch: its furthest ancestor among `accounts`.
 * An account whose parent isn't in the list is a top, so passing the accounts
 * of one type keeps each branch within that type. In a parent loop, the walk
 * stops before it would revisit an account.
 */
export function branchTops<T extends TreeAccount>(
  accounts: readonly T[],
): Map<number, T> {
  const byId = new Map(
    accounts.map((account) => [account.account_id, account]),
  );
  const tops = new Map<number, T>();
  for (const account of accounts) {
    const walked = new Set([account.account_id]);
    let top = account;
    for (;;) {
      const parent =
        top.parent_id === null ? undefined : byId.get(top.parent_id);
      if (parent === undefined || walked.has(parent.account_id)) break;
      walked.add(parent.account_id);
      top = parent;
    }
    tops.set(account.account_id, top);
  }
  return tops;
}

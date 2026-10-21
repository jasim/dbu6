/*
 * Where an account sits in the tree, as the screens show it under its name:
 * the names of its parents from the top down, "Expenses > Kitchen". A top
 * account has none. The hierarchy comes only from `parent_id`, never from the
 * account's name.
 *
 * One way to compute it, at every scale, so no screen walks the tree once per
 * row:
 *
 * - `accountParentPaths` turns a list of accounts into every account's
 *   parent path at once. The server's `loadAccountParentPaths` and the
 *   frontend's `useAccountParentPaths` both build on it, from one read of the
 *   accounts each.
 * - Raw SQL joins `scoped_account_paths` (modules/ledger-sql), which yields
 *   the same `parent_path` for every account in the same statement.
 * - A report names an account in a column that references the accounts
 *   table (`accountNameColumn`), and Sapporta draws the table's computed
 *   `parentPath` under the name.
 */

/** What joins the names of a parent path, in TypeScript and in SQL. */
export const ACCOUNT_PATH_SEPARATOR = " > ";

/** An account as its parent path needs it. */
export type PathAccount = {
  id: number;
  name: string;
  parent_id: number | null;
};

/**
 * Every account's parent path, by its id: "Expenses > Kitchen", or null for an
 * account with no parent among `accounts`. Each parent's path is worked out
 * once, however many accounts sit under it. A parent loop, which the database
 * refuses, ends the path where it would repeat rather than throw: this only
 * labels accounts.
 */
export function accountParentPaths(
  accounts: readonly PathAccount[],
): Map<number, string | null> {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const pathTo = new Map<number, string | null>();

  // The path down to and including `account`, for its children.
  const pathThrough = (account: PathAccount, walking: Set<number>): string => {
    const above = parentPathOf(account, walking);
    return above === null
      ? account.name
      : `${above}${ACCOUNT_PATH_SEPARATOR}${account.name}`;
  };
  const parentPathOf = (
    account: PathAccount,
    walking: Set<number>,
  ): string | null => {
    const known = pathTo.get(account.id);
    if (known !== undefined) return known;
    const parent =
      account.parent_id === null ? undefined : byId.get(account.parent_id);
    walking.add(account.id);
    const path =
      parent === undefined || walking.has(parent.id)
        ? null
        : pathThrough(parent, walking);
    pathTo.set(account.id, path);
    return path;
  };

  for (const account of accounts) parentPathOf(account, new Set());
  return pathTo;
}

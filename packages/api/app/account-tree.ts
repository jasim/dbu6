/*
 * Accounts form a tree through `parent_id`, and entries can sit on any account
 * in it, parents included. A report either puts each account under the top of
 * its branch (`branchTops`) or keeps the whole tree with a total on every
 * node (`accountTree`); either way every entry counts exactly once however
 * deep the tree goes. The hierarchy comes only from `parent_id`, never from
 * the account's name.
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

/** An account in a tree, with the amount of its own entries. */
export type AmountAccount = TreeAccount & { name: string; amount: number };

/**
 * An account with its own amount (`own`), the amount of everything on it
 * and below it (`total`), and its children.
 */
export type AccountNode<T extends AmountAccount> = {
  account: T;
  own: number;
  total: number;
  children: AccountNode<T>[];
};

/**
 * The accounts as a tree: the top nodes are the accounts whose parent isn't
 * among `accounts`, and each node holds its children. At every level nodes
 * are ranked by total, largest first, then by name. A subtree in which no
 * account has an amount is left out. An account in a parent loop has no
 * parent to hang from, so it becomes a top node; each account appears once.
 */
export function accountTree<T extends AmountAccount>(
  accounts: readonly T[],
): AccountNode<T>[] {
  const byId = new Map(
    accounts.map((account) => [account.account_id, account]),
  );
  const inLoop = loopedAccounts(accounts, byId);
  const childrenOf = new Map<number, T[]>();
  const tops: T[] = [];
  for (const account of accounts) {
    const parent =
      account.parent_id === null ? undefined : byId.get(account.parent_id);
    if (parent === undefined || inLoop.has(account.account_id)) {
      tops.push(account);
    } else {
      const siblings = childrenOf.get(parent.account_id) ?? [];
      siblings.push(account);
      childrenOf.set(parent.account_id, siblings);
    }
  }

  const node = (account: T): AccountNode<T> | null => {
    const children = ranked(
      (childrenOf.get(account.account_id) ?? []).flatMap((child) => {
        const built = node(child);
        return built ? [built] : [];
      }),
    );
    if (account.amount === 0 && children.length === 0) return null;
    return {
      account,
      own: account.amount,
      total:
        account.amount +
        children.reduce((total, child) => total + child.total, 0),
      children,
    };
  };

  return ranked(
    tops.flatMap((account) => {
      const built = node(account);
      return built ? [built] : [];
    }),
  );
}

/** The accounts whose parent chain comes back to them. */
function loopedAccounts<T extends TreeAccount>(
  accounts: readonly T[],
  byId: ReadonlyMap<number, T>,
): Set<number> {
  const looped = new Set<number>();
  for (const account of accounts) {
    const walked = new Set<number>();
    let parentId = account.parent_id;
    while (parentId !== null && !walked.has(parentId)) {
      if (parentId === account.account_id) {
        looped.add(account.account_id);
        break;
      }
      walked.add(parentId);
      parentId = byId.get(parentId)?.parent_id ?? null;
    }
  }
  return looped;
}

function ranked<T extends AmountAccount>(
  nodes: AccountNode<T>[],
): AccountNode<T>[] {
  return nodes.sort(
    (a, b) =>
      b.total - a.total ||
      (a.account.name < b.account.name
        ? -1
        : a.account.name > b.account.name
          ? 1
          : 0),
  );
}

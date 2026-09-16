/*
 * Accounts form a tree through `parent_id`, and entries can sit on any account
 * in it, parents included. A report puts each account under the top of its
 * branch (`branchTops`), keeps the whole tree with a total on every node
 * (`accountTree`), or takes one account with everything under it
 * (`subtree`); either way every entry counts exactly once however deep the
 * tree goes. The hierarchy comes only from `parent_id`, never from the
 * account's name.
 *
 * The database refuses a loop in `parent_id`
 * (migrations/0004_account_tree_rules.sql), so one here is corrupt data with
 * no tree to show: each of these throws on one, anywhere among the accounts it
 * is given, rather than pick a shape for it.
 */

export type TreeAccount = { account_id: number; parent_id: number | null };

/**
 * The top of each account's branch: its furthest ancestor among `accounts`.
 * An account whose parent isn't in the list is a top, so passing the accounts
 * of one type keeps each branch within that type.
 */
export function branchTops<T extends TreeAccount>(
  accounts: readonly T[],
): Map<number, T> {
  const { tops, childrenOf } = forest(accounts);
  return new Map(
    tops.flatMap((top) =>
      withDescendants(top, childrenOf).map(
        (account) => [account.account_id, top] as const,
      ),
    ),
  );
}

/**
 * The account with `accountId` and every account under it among `accounts`,
 * parents before children; empty when the account isn't in the list.
 */
export function subtree<T extends TreeAccount>(
  accounts: readonly T[],
  accountId: number,
): T[] {
  const { childrenOf } = forest(accounts);
  const account = accounts.find(
    (candidate) => candidate.account_id === accountId,
  );
  return account === undefined ? [] : withDescendants(account, childrenOf);
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
 * account has an amount is left out.
 */
export function accountTree<T extends AmountAccount>(
  accounts: readonly T[],
): AccountNode<T>[] {
  const { tops, childrenOf } = forest(accounts);

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

/** Accounts as tops, and each account's children by its id. */
type Forest<T extends TreeAccount> = {
  tops: T[];
  childrenOf: ReadonlyMap<number, readonly T[]>;
};

/**
 * `accounts` as a forest. The tops are the accounts whose parent isn't among
 * `accounts`; every other account hangs from its parent. An account no top
 * reaches has a parent chain that loops, so this throws, naming the loop.
 */
function forest<T extends TreeAccount>(accounts: readonly T[]): Forest<T> {
  const byId = new Map(
    accounts.map((account) => [account.account_id, account]),
  );
  const tops: T[] = [];
  const childrenOf = new Map<number, T[]>();
  for (const account of accounts) {
    const parent = parentOf(account, byId);
    if (parent === undefined) {
      tops.push(account);
    } else {
      const siblings = childrenOf.get(parent.account_id) ?? [];
      siblings.push(account);
      childrenOf.set(parent.account_id, siblings);
    }
  }

  const reached = new Set(
    tops
      .flatMap((top) => withDescendants(top, childrenOf))
      .map((account) => account.account_id),
  );
  const stranded = accounts.find((account) => !reached.has(account.account_id));
  if (stranded !== undefined) throw new Error(loopMessage(stranded, byId));
  return { tops, childrenOf };
}

/**
 * The loop a stranded account's parent chain runs into, by account id from
 * its lowest: "parent_id loops through accounts 1 → 4 → 3 → 1".
 */
function loopMessage<T extends TreeAccount>(
  account: T,
  byId: ReadonlyMap<number, T>,
): string {
  const chain: number[] = [];
  let current = account;
  while (!chain.includes(current.account_id)) {
    chain.push(current.account_id);
    // A stranded account's parent is among the accounts, and stranded too.
    current = parentOf(current, byId)!;
  }
  const loop = chain.slice(chain.indexOf(current.account_id));
  const lowest = loop.indexOf(Math.min(...loop));
  const ids = [...loop.slice(lowest), ...loop.slice(0, lowest), loop[lowest]];
  return `parent_id loops through accounts ${ids.join(" → ")}`;
}

function parentOf<T extends TreeAccount>(
  account: T,
  byId: ReadonlyMap<number, T>,
): T | undefined {
  return account.parent_id === null ? undefined : byId.get(account.parent_id);
}

/** The account and every account under it, parents before children. */
function withDescendants<T extends TreeAccount>(
  account: T,
  childrenOf: ReadonlyMap<number, readonly T[]>,
): T[] {
  return [
    account,
    ...(childrenOf.get(account.account_id) ?? []).flatMap((child) =>
      withDescendants(child, childrenOf),
    ),
  ];
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

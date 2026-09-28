import type Database from "better-sqlite3";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Temporal } from "@sapporta/shared/temporal";
import {
  accounts,
  accountsTable,
  type AccountType,
} from "../../schema/accounts.js";
import {
  OPENING_BALANCES_NAME,
  type ChartAccount,
} from "../../../shared/index.js";
import { hledgerAccountNames } from "../journal-plan/index.js";
import { allRows, type LedgerAuth } from "../ledger-sql/index.js";

/** An account in scope, as the accounts table holds it. */
export type LedgerAccount = {
  id: number;
  name: string;
  account_type: string | null;
};

/** The accounts in scope by their name, which is unique in a user's books. */
export function loadAccountsByName(
  db: any,
  auth: LedgerAuth,
): Map<string, { id: number; account_type: AccountType }> {
  const access = auth.rowSecurity.forTable(accounts);
  return new Map(
    db
      .select()
      .from(accountsTable)
      .where(access.ownedRows())
      .all()
      .map((a: any) => [a.name, { id: a.id, account_type: a.account_type }]),
  );
}

/**
 * Each account in scope's hledger name, by its own name: its path down the
 * account tree, as `Expenses:Food:Dining Out` (`hledgerAccountNames`).
 */
export function loadHledgerAccountNames(
  db: any,
  auth: LedgerAuth,
): Map<string, string> {
  const access = auth.rowSecurity.forTable(accounts);
  return hledgerAccountNames(
    db
      .select({
        id: accountsTable.id,
        name: accountsTable.name,
        parent_id: accountsTable.parent_id,
      })
      .from(accountsTable)
      .where(access.ownedRows())
      .all(),
  );
}

export function loadLedgerAccounts(
  sqlite: Database.Database,
  auth: LedgerAuth,
): LedgerAccount[] {
  return allRows<LedgerAccount>(
    sqlite,
    auth,
    `SELECT id, name, account_type FROM scoped_accounts`,
  );
}

/** The Equity account opening entries post against by default. */
export const OPENING_BALANCES_ACCOUNT = OPENING_BALANCES_NAME;

/** An account by id and name. */
export type NamedAccount = { id: number; name: string };

/**
 * The account named Opening Balances, whatever its type, or null when the
 * books have none. Names are unique, so there is at most one.
 */
export function findOpeningBalancesAccount(
  db: any,
  auth: LedgerAuth,
): (NamedAccount & { account_type: AccountType }) | null {
  const access = auth.rowSecurity.forTable(accounts);
  return (
    db
      .select({
        id: accountsTable.id,
        name: accountsTable.name,
        account_type: accountsTable.account_type,
      })
      .from(accountsTable)
      .where(
        and(
          access.ownedRows(),
          eq(accountsTable.name, OPENING_BALANCES_ACCOUNT),
        ),
      )
      .get() ?? null
  );
}

/**
 * Creates the Opening Balances account, as an Equity account under the one
 * Equity root; with no Equity root, or more than one, as a root of its own.
 * Runs inside the caller's transaction.
 */
export function createOpeningBalancesAccount(
  tx: any,
  auth: LedgerAuth,
): NamedAccount {
  const access = auth.rowSecurity.forTable(accounts);
  const roots: { id: number }[] = tx
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(
      and(
        access.ownedRows(),
        eq(accountsTable.account_type, "Equity"),
        isNull(accountsTable.parent_id),
      ),
    )
    .all();
  const values = access.insertValuesSync(tx, {
    name: OPENING_BALANCES_ACCOUNT,
    account_type: "Equity",
    parent_id: roots.length === 1 ? roots[0].id : null,
  });
  return tx
    .insert(accountsTable)
    .values(values)
    .returning({ id: accountsTable.id, name: accountsTable.name })
    .get();
}

/** An account in scope with where it sits. */
export type ChartedAccount = {
  id: number;
  name: string;
  parent_id: number | null;
  account_type: AccountType;
};

/** Whether the books have no other account of this name (`self` aside). */
export function isAccountNameFree(
  chart: readonly ChartedAccount[],
  name: string,
  self: number | null,
): boolean {
  return chart.every((account) => account.name !== name || account.id === self);
}

/**
 * Whether `id` is `accountId` itself or an account under it, following
 * parents up. The tree triggers prevent a loop; one left in the data ends
 * the walk rather than spinning.
 */
export function isInAccountBranch(
  chart: readonly ChartedAccount[],
  accountId: number,
  id: number,
): boolean {
  const parentOf = new Map(
    chart.map((account) => [account.id, account.parent_id]),
  );
  const walked = new Set<number>();
  for (let at: number | null = id; at !== null; at = parentOf.get(at) ?? null) {
    if (walked.has(at)) return false;
    walked.add(at);
    if (at === accountId) return true;
  }
  return false;
}

/** The account and every account under it, by id. */
export function accountBranchIds(
  chart: readonly ChartedAccount[],
  id: number,
): Set<number> {
  return new Set(
    chart
      .filter((account) => isInAccountBranch(chart, id, account.id))
      .map((account) => account.id),
  );
}

/**
 * Whether `parentId` can be the parent of an account of `type` that is
 * `self`: null, a type's own top account, or an account of that type that
 * isn't `self` or an account under it.
 */
export function isSuitableAccountParent(
  chart: readonly ChartedAccount[],
  parentId: number | null,
  type: AccountType,
  self: number | null,
): boolean {
  if (parentId === null) return true;
  const parent = chart.find((account) => account.id === parentId);
  if (parent === undefined || parent.account_type !== type) return false;
  return self === null || !isInAccountBranch(chart, self, parent.id);
}

/** Every account in scope with its parent, in the order they were made. */
export function loadAccountChart(db: any, auth: LedgerAuth): ChartedAccount[] {
  const access = auth.rowSecurity.forTable(accounts);
  return db
    .select({
      id: accountsTable.id,
      name: accountsTable.name,
      parent_id: accountsTable.parent_id,
      account_type: accountsTable.account_type,
    })
    .from(accountsTable)
    .where(access.ownedRows())
    .orderBy(accountsTable.id)
    .all();
}

/**
 * Creates `chart`'s accounts, in its order, each under the parent it names:
 * one made earlier in the list or already in the books. Runs inside the
 * caller's transaction; the chart's rules are the caller's to check, and the
 * tree triggers still refuse a parent of another type.
 */
export function insertChartAccounts(
  tx: any,
  auth: LedgerAuth,
  chart: readonly ChartAccount[],
): ChartedAccount[] {
  const ids = new Map(
    loadAccountChart(tx, auth).map((account) => [account.name, account.id]),
  );
  return chart.map((account) => {
    const parentId = account.parent === null ? null : ids.get(account.parent);
    if (parentId === undefined) {
      throw new Error(
        `${account.name}'s parent ${account.parent} does not exist.`,
      );
    }
    const created = insertAccount(tx, auth, {
      name: account.name,
      account_type: account.account_type,
      parent_id: parentId,
    });
    ids.set(created.name, created.id);
    return created;
  });
}

/** The columns that place an account: its name, type and parent. */
export type AccountPlacement = Omit<ChartedAccount, "id">;

/**
 * Creates one account, in the caller's transaction. The tree triggers
 * refuse a parent of another type; the unique index a taken name.
 */
export function insertAccount(
  tx: any,
  auth: LedgerAuth,
  placement: AccountPlacement,
): ChartedAccount {
  const access = auth.rowSecurity.forTable(accounts);
  return tx
    .insert(accountsTable)
    .values(access.insertValuesSync(tx, placement))
    .returning({
      id: accountsTable.id,
      name: accountsTable.name,
      parent_id: accountsTable.parent_id,
      account_type: accountsTable.account_type,
    })
    .get();
}

/**
 * Renames, retypes and moves one account in a single statement, so the tree
 * triggers see its new type and parent together. In the caller's
 * transaction; an account with sub-accounts can't change type this way —
 * `placeAccount` is what moves a whole branch.
 */
export function updateAccount(
  tx: any,
  auth: LedgerAuth,
  id: number,
  placement: AccountPlacement,
): void {
  const access = auth.rowSecurity.forTable(accounts);
  tx.update(accountsTable)
    .set({ ...placement, updated_at: Temporal.Now.instant() })
    .where(access.ownedRows(eq(accountsTable.id, id)))
    .run();
}

/**
 * Places one account — its name, type and parent — with its branch, in the
 * caller's transaction, and says how many sub-accounts changed type with it.
 *
 * A type change with sub-accounts has no single statement: SQLite checks
 * each written row, and the update trigger refuses a child whose type
 * differs from its parent's. So the branch comes off, changes type, and goes
 * back on (migrations/0004_account_tree_rules.sql).
 */
export function placeAccount(
  tx: any,
  auth: LedgerAuth,
  id: number,
  placement: AccountPlacement,
): number {
  const access = auth.rowSecurity.forTable(accounts);
  const chart = loadAccountChart(tx, auth);
  const account = chart.find((one) => one.id === id);
  if (account === undefined) throw new Error(`No account ${id} to place.`);
  const descendants =
    account.account_type === placement.account_type
      ? []
      : chart.filter(
          (one) => one.id !== id && isInAccountBranch(chart, id, one.id),
        );
  if (descendants.length === 0) {
    updateAccount(tx, auth, id, placement);
    return 0;
  }

  const ids = descendants.map((one) => one.id);
  // Every descendant, not only the direct children: a middle account still
  // held by its own children would fire the trigger's type check while they
  // carry the old type.
  tx.update(accountsTable)
    .set({ parent_id: null, updated_at: Temporal.Now.instant() })
    .where(access.ownedRows(inArray(accountsTable.id, ids)))
    .run();
  tx.update(accountsTable)
    .set({
      account_type: placement.account_type,
      updated_at: Temporal.Now.instant(),
    })
    .where(access.ownedRows(inArray(accountsTable.id, ids)))
    .run();
  updateAccount(tx, auth, id, placement);
  for (const descendant of descendants) {
    updateAccount(tx, auth, descendant.id, {
      name: descendant.name,
      account_type: placement.account_type,
      parent_id: descendant.parent_id,
    });
  }
  return descendants.length;
}

/**
 * Deletes one account, in the caller's transaction. The caller makes sure
 * nothing is on it or under it.
 */
export function deleteAccount(tx: any, auth: LedgerAuth, id: number): void {
  const access = auth.rowSecurity.forTable(accounts);
  tx.delete(accountsTable)
    .where(access.ownedRows(eq(accountsTable.id, id)))
    .run();
}

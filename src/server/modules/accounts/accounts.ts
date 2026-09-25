import type Database from "better-sqlite3";
import { and, eq, isNull } from "drizzle-orm";
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
 * transaction; an account with sub-accounts can't change type.
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
 * Deletes one account, in the caller's transaction. The caller makes sure
 * nothing is on it or under it.
 */
export function deleteAccount(tx: any, auth: LedgerAuth, id: number): void {
  const access = auth.rowSecurity.forTable(accounts);
  tx.delete(accountsTable)
    .where(access.ownedRows(eq(accountsTable.id, id)))
    .run();
}

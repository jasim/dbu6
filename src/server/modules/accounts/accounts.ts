import type Database from "better-sqlite3";
import { and, eq, isNull } from "drizzle-orm";
import {
  accounts,
  accountsTable,
  type AccountType,
} from "../../schema/accounts.js";
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
export const OPENING_BALANCES_ACCOUNT = "Opening Balances";

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

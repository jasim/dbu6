import type Database from "better-sqlite3";
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

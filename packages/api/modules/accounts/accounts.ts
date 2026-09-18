import type Database from "better-sqlite3";
import { accounts, accountsTable } from "../../schema/accounts.js";
import {
  allRows,
  ledgerCtes,
  type LedgerAuth,
  type ScopeParams,
} from "../ledger-sql/index.js";

/** An account in scope, as the accounts table holds it. */
export type LedgerAccount = {
  id: number;
  name: string;
  account_type: string | null;
};

export function loadAccountsByName(
  db: any,
  auth?: LedgerAuth,
): Map<string, number> {
  const access = auth?.rowSecurity.forTable(accounts);
  return new Map(
    db
      .select()
      .from(accountsTable)
      .where(access ? access.ownedRows() : undefined)
      .all()
      .map((a: any) => [a.name, a.id]),
  );
}

export function loadLedgerAccounts(
  sqlite: Database.Database,
  scope: ScopeParams,
): LedgerAccount[] {
  return allRows<LedgerAccount>(
    sqlite,
    `${ledgerCtes} SELECT id, name, account_type FROM scoped_accounts`,
    scope,
  );
}

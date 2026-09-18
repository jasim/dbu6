import type Database from "better-sqlite3";
import type { SapportaAuthContext } from "@sapporta/server";

// Row scoping for the ledger. Drizzle queries scope their rows through the
// auth every store takes; raw SQL reads the ledger through the `scoped_*`
// CTEs below. The CTEs still filter workspace and user by hand, which B1 in
// PLAN.md replaces with Sapporta's row security.

/** What a ledger store needs of the request's auth: its row security. */
export type LedgerAuth = Pick<SapportaAuthContext, "rowSecurity">;

export type ScopeParams = {
  workspaceId: string;
  userId: string;
};

export const ledgerCtes = `
WITH RECURSIVE
scoped_accounts AS (
  SELECT *
  FROM accounts
  WHERE workspace_id = @workspaceId
    AND scoped_to_user_id = @userId
),
scoped_journals AS (
  SELECT *
  FROM journals
  WHERE workspace_id = @workspaceId
    AND scoped_to_user_id = @userId
),
scoped_journal_entries AS (
  SELECT *
  FROM journal_entries
  WHERE workspace_id = @workspaceId
    AND scoped_to_user_id = @userId
),
scoped_draft_transactions AS (
  SELECT *
  FROM draft_transactions
  WHERE workspace_id = @workspaceId
    AND scoped_to_user_id = @userId
)`;

export function allRows<T>(
  sqlite: Database.Database,
  sql: string,
  params: Record<string, unknown>,
): T[] {
  return sqlite.prepare(sql).all(params) as T[];
}

export function oneRow<T>(
  sqlite: Database.Database,
  sql: string,
  params: Record<string, unknown>,
): T | null {
  return (sqlite.prepare(sql).get(params) as T | undefined) ?? null;
}

import { asc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  categorizationRuleRequestTransactionSchema,
  type CategorizationRuleRequest,
  type CategorizationRuleRequestTransaction,
} from "../../../shared/index.js";
import { accountsTable } from "../../schema/accounts.js";
import {
  categorizationRuleRequests,
  categorizationRuleRequestsTable,
} from "../../schema/categorization-rule-requests.js";
import type { LedgerAuth } from "../ledger-sql/index.js";

/*
 * The categorization_rule_requests rows in scope: what the user asked the
 * categoriser about drafts, until their coding agent has encoded it.
 */

const transactionsColumnSchema = z
  .array(categorizationRuleRequestTransactionSchema)
  .min(1);

/** A statement account's rule requests, oldest first, with each account's name. */
export function loadCategorizationRuleRequests(
  db: any,
  auth: LedgerAuth,
  baseAccountId: number,
): CategorizationRuleRequest[] {
  return selectRuleRequests(
    db,
    auth,
    eq(categorizationRuleRequestsTable.base_account_id, baseAccountId),
  );
}

/** The rule request `id`, or null when it isn't the caller's. */
export function loadCategorizationRuleRequest(
  db: any,
  auth: LedgerAuth,
  id: number,
): CategorizationRuleRequest | null {
  return (
    selectRuleRequests(
      db,
      auth,
      eq(categorizationRuleRequestsTable.id, id),
    )[0] ?? null
  );
}

function selectRuleRequests(
  db: any,
  auth: LedgerAuth,
  where: SQL,
): CategorizationRuleRequest[] {
  const access = auth.rowSecurity.forTable(categorizationRuleRequests);
  const rows: {
    ruleRequest: typeof categorizationRuleRequestsTable.$inferSelect;
    accountName: string;
  }[] = db
    .select({
      ruleRequest: categorizationRuleRequestsTable,
      accountName: accountsTable.name,
    })
    .from(categorizationRuleRequestsTable)
    .innerJoin(
      accountsTable,
      eq(accountsTable.id, categorizationRuleRequestsTable.account_id),
    )
    .where(access.ownedRows(where))
    .orderBy(asc(categorizationRuleRequestsTable.id))
    .all();
  return rows.map(({ ruleRequest, accountName }) => ({
    id: ruleRequest.id,
    base_account_id: ruleRequest.base_account_id,
    account: { id: ruleRequest.account_id, name: accountName },
    transactions: transactionsColumnSchema.parse(
      JSON.parse(ruleRequest.transactions),
    ),
    note: ruleRequest.note,
  }));
}

export interface NewCategorizationRuleRequest {
  baseAccountId: number;
  accountId: number;
  transactions: readonly CategorizationRuleRequestTransaction[];
  note: string;
}

/** Adds a rule request and returns its id. The rules are the caller's to check. */
export function insertCategorizationRuleRequest(
  tx: any,
  auth: LedgerAuth,
  ruleRequest: NewCategorizationRuleRequest,
): number {
  const access = auth.rowSecurity.forTable(categorizationRuleRequests);
  const inserted: { id: number } = tx
    .insert(categorizationRuleRequestsTable)
    .values(
      access.insertValuesSync(tx, {
        base_account_id: ruleRequest.baseAccountId,
        account_id: ruleRequest.accountId,
        transactions: JSON.stringify(ruleRequest.transactions),
        note: ruleRequest.note,
      }),
    )
    .returning({ id: categorizationRuleRequestsTable.id })
    .get();
  return inserted.id;
}

/** Deletes the rule request `id`; how many went, 0 or 1. */
export function deleteCategorizationRuleRequest(
  db: any,
  auth: LedgerAuth,
  id: number,
): number {
  const access = auth.rowSecurity.forTable(categorizationRuleRequests);
  return db
    .delete(categorizationRuleRequestsTable)
    .where(access.ownedRows(eq(categorizationRuleRequestsTable.id, id)))
    .run().changes;
}

/** Deletes a statement account's rule requests; how many went. */
export function clearCategorizationRuleRequests(
  db: any,
  auth: LedgerAuth,
  baseAccountId: number,
): number {
  const access = auth.rowSecurity.forTable(categorizationRuleRequests);
  return db
    .delete(categorizationRuleRequestsTable)
    .where(
      access.ownedRows(
        eq(categorizationRuleRequestsTable.base_account_id, baseAccountId),
      ),
    )
    .run().changes;
}

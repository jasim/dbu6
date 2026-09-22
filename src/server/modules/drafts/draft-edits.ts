import { eq, inArray } from "drizzle-orm";
import type { LedgerAuth } from "../ledger-sql/index.js";
import {
  draftTransactions,
  draftTransactionsTable,
} from "../../schema/draft-journals.js";

/*
 * Changes to drafts already saved: reclassifying some of them, and clearing
 * an account's drafts once they are posted.
 */

export type SavedDraft = typeof draftTransactionsTable.$inferSelect;

// The caller's drafts among `ids`; ids it can't see are left out.
export function loadDraftsById(
  db: any,
  ids: number[],
  auth: LedgerAuth,
): SavedDraft[] {
  const draftAccess = auth.rowSecurity.forTable(draftTransactions);
  return db
    .select()
    .from(draftTransactionsTable)
    .where(draftAccess.ownedRows(inArray(draftTransactionsTable.id, ids)))
    .all();
}

export interface ReclassifiedDraft {
  id: number;
  narration: string;
  accountId: number | null;
}

// Saves each draft's new narration and category, all or none.
export function saveReclassifiedDrafts(
  db: any,
  drafts: readonly ReclassifiedDraft[],
  auth: LedgerAuth,
): void {
  const draftAccess = auth.rowSecurity.forTable(draftTransactions);
  db.transaction((tx: any) => {
    for (const draft of drafts) {
      tx.update(draftTransactionsTable)
        .set({ narration: draft.narration, account_id: draft.accountId })
        .where(draftAccess.ownedRows(eq(draftTransactionsTable.id, draft.id)))
        .run();
    }
  });
}

// Deletes every draft under the account. Runs inside the caller's
// transaction, so posting clears the drafts with the journals it writes.
export function deleteAccountDrafts(
  tx: any,
  baseAccountId: number,
  auth: LedgerAuth,
): void {
  const draftAccess = auth.rowSecurity.forTable(draftTransactions);
  tx.delete(draftTransactionsTable)
    .where(
      draftAccess.ownedRows(
        eq(draftTransactionsTable.base_account_id, baseAccountId),
      ),
    )
    .run();
}

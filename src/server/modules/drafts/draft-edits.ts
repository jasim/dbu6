import { eq, inArray, sql } from "drizzle-orm";
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
  // The source narration, with a Google Pay recipient now in front when a
  // takeout named one: the one change a saved source narration takes.
  sourceNarration: string;
  accountId: number | null;
  // A comment for a draft that has none yet, such as its Google Pay
  // recipient. A comment the draft already has stays.
  comment?: string | null;
}

// Saves each draft's source narration and account, and its comment where it
// has none, all or none.
export function saveReclassifiedDrafts(
  db: any,
  drafts: readonly ReclassifiedDraft[],
  auth: LedgerAuth,
): void {
  const draftAccess = auth.rowSecurity.forTable(draftTransactions);
  db.transaction((tx: any) => {
    for (const draft of drafts) {
      tx.update(draftTransactionsTable)
        .set({
          source_narration: draft.sourceNarration,
          account_id: draft.accountId,
          ...(draft.comment
            ? {
                comment: sql`coalesce(${draftTransactionsTable.comment}, ${draft.comment})`,
              }
            : {}),
        })
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

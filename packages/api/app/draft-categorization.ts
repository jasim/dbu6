import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { formatPlainDate } from "@sapporta/shared/temporal";
import {
  parseAccount,
  UNCATEGORIZED,
  type Account,
} from "../bank-importer/domain/Account.js";
import { type Chrono, unsafeAsChrono } from "../bank-importer/domain/Chrono.js";
import type { DraftCategorizedTransaction } from "../bank-importer/domain/DraftCategorizedTransaction.js";
import type { RowScopeAuth } from "../bank-importer/draft-persistence.js";
import { accounts, accountsTable } from "../schema/accounts.js";
import {
  draftTransactions,
  draftTransactionsTable,
} from "../schema/draft-journals.js";

type DraftRow = typeof draftTransactionsTable.$inferSelect;

export interface LoadedDrafts {
  baseAccount: Account;
  baseAccountName: string;
  categorized: Chrono<DraftCategorizedTransaction>;
  drafts: DraftRow[];
}

export function loadCategorizedDrafts(
  db: BetterSQLite3Database,
  baseAccountId: number,
  auth: RowScopeAuth,
): LoadedDrafts | null {
  const accountAccess = auth.rowSecurity.forTable(accounts);
  const draftAccess = auth.rowSecurity.forTable(draftTransactions);
  const baseAccountRow = db
    .select({ name: accountsTable.name })
    .from(accountsTable)
    .where(accountAccess.ownedRows(eq(accountsTable.id, baseAccountId)))
    .get();
  if (!baseAccountRow) return null;

  const drafts = db
    .select()
    .from(draftTransactionsTable)
    .where(
      draftAccess.ownedRows(
        eq(draftTransactionsTable.base_account_id, baseAccountId),
      ),
    )
    .orderBy(asc(draftTransactionsTable.date), asc(draftTransactionsTable.id))
    .all();

  const accountNameById = new Map<number, string>(
    db
      .select({ id: accountsTable.id, name: accountsTable.name })
      .from(accountsTable)
      .where(accountAccess.ownedRows())
      .all()
      .map((a: { id: number; name: string }) => [a.id, a.name]),
  );

  const categorized = unsafeAsChrono(
    drafts.map((d: DraftRow): DraftCategorizedTransaction => ({
      transaction: {
        date: formatPlainDate(d.date),
        narration: d.narration,
        withdrawal: d.withdrawal,
        deposit: d.deposit,
        balance: d.balance_assertion_base_account,
        source_reference: d.source_reference,
        source_transaction_key: d.source_transaction_key,
      },
      account:
        d.account_id === null
          ? UNCATEGORIZED
          : parseAccount(accountNameById.get(d.account_id) ?? UNCATEGORIZED),
      draftId: d.id,
      accountId: d.account_id,
    })),
  );

  return {
    baseAccount: parseAccount(baseAccountRow.name),
    baseAccountName: baseAccountRow.name,
    categorized,
    drafts,
  };
}

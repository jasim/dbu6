import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import {
  Temporal,
  formatPlainDate,
  parsePlainDate,
} from "@sapporta/shared/temporal";
import {
  AmbiguousDuplicateError,
  AssertionConflictError,
} from "../statement/index.js";
import type { Chrono } from "../values/index.js";
import {
  resolveAccountIdForCategorized,
  type CategorizedTransaction,
} from "../categorization/index.js";
import {
  draftTransactions,
  draftTransactionsTable,
} from "../../schema/draft-journals.js";
import { Temporal as TemporalValue } from "@sapporta/shared/temporal";
import {
  findDuplicateCandidates,
  BALANCE_EPSILON,
} from "../reconciliation/index.js";
import type { LedgerAuth } from "../ledger-sql/index.js";
import { loadAccountsByName } from "../accounts/index.js";

export interface PersistSummary {
  inserted: number;
  duplicates: number;
  draftDuplicates: number;
  journalDuplicates: number;
  legacyMatches: number;
  backfilled: number;
}

export type DraftRow = {
  date: Temporal.PlainDate;
  narration: string;
  withdrawal: number;
  deposit: number;
  account_id: number | null;
  base_account_id: number | null;
  balance_assertion_base_account: number | null;
  source_reference: string | null;
  source_transaction_key: string | null;
};

export const sameAccountSkipSchema = z.object({
  date: z.string(),
  narration: z.string(),
  account: z.string(),
});
export type SameAccountSkip = z.infer<typeof sameAccountSkipSchema>;

function toDraftRow(
  ct: CategorizedTransaction,
  accountsByName: Map<string, number>,
  baseAccountId: number | null,
): { row: DraftRow; skip: SameAccountSkip | null } {
  const { transaction: t, account } = ct;
  const { accountId, sameAccountSkip } = resolveAccountIdForCategorized(
    account,
    accountsByName,
    baseAccountId,
  );
  const row: DraftRow = {
    date: parsePlainDate(t.date),
    narration: t.narration,
    withdrawal: t.withdrawal,
    deposit: t.deposit,
    account_id: accountId,
    base_account_id: baseAccountId,
    balance_assertion_base_account: null,
    source_reference: t.source_reference ?? null,
    source_transaction_key: t.source_transaction_key ?? null,
  };
  const skip: SameAccountSkip | null = sameAccountSkip
    ? { date: t.date, narration: t.narration, account }
    : null;
  return { row, skip };
}

// Only the last row of each date carries a balance assertion. The
// draft-balance-assertions report sums the full day's activity before
// checking the assertion on the last (date, id)-ordered row, so the
// day's closing alone catches drift. Per-row assertions would be
// fragile: within-day order in the draft table (insertion order) can
// differ from the statement's printed order (LLM output variance,
// multi-file merges), making middle-of-day assertions fail spuriously
// even when the day's closing is right.
export function toDraftRows(
  db: any,
  baseAccount: string,
  categorized: Chrono<CategorizedTransaction>,
  auth?: LedgerAuth,
): {
  rows: DraftRow[];
  sameAccountSkips: SameAccountSkip[];
  expectedClosingByDate: Map<string, number>;
} {
  const accountsByName = loadAccountsByName(db, auth);
  const baseAccountId = accountsByName.get(baseAccount) ?? null;
  const rows: DraftRow[] = [];
  const sameAccountSkips: SameAccountSkip[] = [];
  const expectedClosingByDate = new Map<string, number>();
  categorized.forEach((ct) => {
    const { row, skip } = toDraftRow(ct, accountsByName, baseAccountId);
    rows.push(row);
    if (skip) sameAccountSkips.push(skip);
    if (ct.transaction.balance !== null) {
      expectedClosingByDate.set(ct.transaction.date, ct.transaction.balance);
    }
  });
  return { rows, sameAccountSkips, expectedClosingByDate };
}

export function persistDrafts(
  db: any,
  rows: DraftRow[],
  expectedClosingByDate: Map<string, number>,
  auth?: LedgerAuth,
): PersistSummary {
  const summary: PersistSummary = {
    inserted: 0,
    duplicates: 0,
    draftDuplicates: 0,
    journalDuplicates: 0,
    legacyMatches: 0,
    backfilled: 0,
  };
  db.transaction((tx: any) => {
    const access = auth?.rowSecurity.forTable(draftTransactions);
    for (const row of rows) {
      const candidates = findDuplicateCandidates(
        tx,
        {
          databaseDate: row.date,
          baseAccountId: row.base_account_id,
          date: formatPlainDate(row.date),
          narration: row.narration,
          withdrawal: row.withdrawal,
          deposit: row.deposit,
          accountId: row.account_id,
          sourceReference: row.source_reference,
          sourceTransactionKey: row.source_transaction_key,
        },
        auth,
      );
      if (candidates.length > 1) {
        throw new AmbiguousDuplicateError(
          row.source_transaction_key,
          candidates.map((candidate) =>
            candidate.target === "draft"
              ? `draft:${candidate.id}`
              : `journal:${candidate.id}:entry:${candidate.journalEntryId}`,
          ),
        );
      }
      const existing = candidates[0];
      if (!existing) {
        const values = access ? access.insertValuesSync(tx, row) : row;
        tx.insert(draftTransactionsTable).values(values).run();
        summary.inserted++;
        continue;
      }
      summary.duplicates++;
      if (existing.target === "draft") {
        summary.draftDuplicates++;
      } else {
        summary.journalDuplicates++;
      }
      if (existing.matchType !== "source-key") {
        summary.legacyMatches++;
      }
      if (existing.target === "draft" && existing.matchType !== "source-key") {
        tx.update(draftTransactionsTable)
          .set({
            source_reference: row.source_reference,
            source_transaction_key: row.source_transaction_key,
            updated_at: TemporalValue.Now.instant(),
          })
          .where(
            access
              ? access.ownedRows(eq(draftTransactionsTable.id, existing.id))
              : eq(draftTransactionsTable.id, existing.id),
          )
          .run();
        summary.backfilled++;
      }
    }

    placeAssertionsAfterDedupe(
      tx,
      rows[0]?.base_account_id ?? null,
      expectedClosingByDate,
      auth,
    );
  });
  return summary;
}

function placeAssertionsAfterDedupe(
  tx: any,
  baseAccountId: number | null,
  expectedClosingByDate: Map<string, number>,
  auth?: LedgerAuth,
): void {
  if (baseAccountId === null) return;
  const access = auth?.rowSecurity.forTable(draftTransactions);
  for (const [dateText, expected] of expectedClosingByDate) {
    const databaseDate = parsePlainDate(dateText);
    const dateWhere = and(
      eq(draftTransactionsTable.base_account_id, baseAccountId),
      eq(draftTransactionsTable.date, databaseDate),
    );
    const scopedDateWhere = access ? access.ownedRows(dateWhere) : dateWhere;
    const existingAssertions = tx
      .select({
        assertion: draftTransactionsTable.balance_assertion_base_account,
      })
      .from(draftTransactionsTable)
      .where(
        and(
          scopedDateWhere,
          isNotNull(draftTransactionsTable.balance_assertion_base_account),
        ),
      )
      .all();
    for (const existing of existingAssertions) {
      if (Math.abs(existing.assertion - expected) > BALANCE_EPSILON) {
        throw new AssertionConflictError(
          dateText,
          existing.assertion,
          expected,
        );
      }
    }

    const finalDraft = tx
      .select({ id: draftTransactionsTable.id })
      .from(draftTransactionsTable)
      .where(scopedDateWhere)
      .orderBy(desc(draftTransactionsTable.id))
      .limit(1)
      .get();
    if (!finalDraft) continue;

    const now = TemporalValue.Now.instant();
    tx.update(draftTransactionsTable)
      .set({ balance_assertion_base_account: null, updated_at: now })
      .where(scopedDateWhere)
      .run();
    tx.update(draftTransactionsTable)
      .set({ balance_assertion_base_account: expected, updated_at: now })
      .where(
        access
          ? access.ownedRows(eq(draftTransactionsTable.id, finalDraft.id))
          : eq(draftTransactionsTable.id, finalDraft.id),
      )
      .run();
  }
}

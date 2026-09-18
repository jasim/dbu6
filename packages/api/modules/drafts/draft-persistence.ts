import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  Temporal,
  formatPlainDate,
  parsePlainDate,
} from "@sapporta/shared/temporal";
import type { Chrono } from "../values/index.js";
import type { Abacus } from "../statement/index.js";
import {
  draftTransactions,
  draftTransactionsTable,
} from "../../schema/draft-journals.js";
import { Temporal as TemporalValue } from "@sapporta/shared/temporal";
import {
  AmbiguousDuplicateError,
  findDuplicateCandidates,
  BALANCE_EPSILON,
} from "../reconciliation/index.js";
import type { LedgerAuth } from "../ledger-sql/index.js";

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

// A day already holds a balance assertion that differs from the closing the
// statement validated for it.
export class AssertionConflictError extends Error {
  override readonly name = "AssertionConflictError";

  constructor(
    readonly date: string,
    readonly existing: number,
    readonly expected: number,
  ) {
    super(
      `Balance assertion conflict on ${date}: existing assertion ${existing} does not match validated statement close ${expected}.`,
    );
  }
}

// A statement row and the ledger account categorization chose for it.
export interface CategorizedStatementRow {
  transaction: Abacus;
  accountId: number | null;
}

function toDraftRow(
  { transaction: t, accountId }: CategorizedStatementRow,
  baseAccountId: number | null,
): DraftRow {
  return {
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
  categorized: Chrono<CategorizedStatementRow>,
  baseAccountId: number | null,
): {
  rows: DraftRow[];
  expectedClosingByDate: Map<string, number>;
} {
  const rows: DraftRow[] = [];
  const expectedClosingByDate = new Map<string, number>();
  categorized.forEach((row) => {
    rows.push(toDraftRow(row, baseAccountId));
    if (row.transaction.balance !== null) {
      expectedClosingByDate.set(row.transaction.date, row.transaction.balance);
    }
  });
  return { rows, expectedClosingByDate };
}

export function persistDrafts(
  db: any,
  rows: DraftRow[],
  expectedClosingByDate: Map<string, number>,
  auth: LedgerAuth,
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
    const access = auth.rowSecurity.forTable(draftTransactions);
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
        const values = access.insertValuesSync(tx, row);
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
          .where(access.ownedRows(eq(draftTransactionsTable.id, existing.id)))
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
  auth: LedgerAuth,
): void {
  if (baseAccountId === null) return;
  const access = auth.rowSecurity.forTable(draftTransactions);
  for (const [dateText, expected] of expectedClosingByDate) {
    const databaseDate = parsePlainDate(dateText);
    const dateWhere = and(
      eq(draftTransactionsTable.base_account_id, baseAccountId),
      eq(draftTransactionsTable.date, databaseDate),
    );
    const scopedDateWhere = access.ownedRows(dateWhere);
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
      .where(access.ownedRows(eq(draftTransactionsTable.id, finalDraft.id)))
      .run();
  }
}

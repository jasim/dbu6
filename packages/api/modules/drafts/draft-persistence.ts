import { and, eq, isNotNull } from "drizzle-orm";
import {
  Temporal,
  formatPlainDate,
  parsePlainDate,
} from "@sapporta/shared/temporal";
import { chronoMap, sameAmount, type Chrono } from "../values/index.js";
import type { Abacus } from "../statement/index.js";
import {
  draftTransactions,
  draftTransactionsTable,
} from "../../schema/draft-journals.js";
import { Temporal as TemporalValue } from "@sapporta/shared/temporal";
import {
  dayClosings,
  draftOrderBy,
  findDuplicate,
} from "../reconciliation/index.js";
import type { LedgerAuth } from "../ledger-sql/index.js";

export interface PersistSummary {
  inserted: number;
  // Which of the rows were saved as new drafts, by their index.
  insertedIndices: number[];
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
  base_account_id: number;
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
  baseAccountId: number,
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

// The drafts to save, and each day's closing, which `persistDrafts` asserts
// on the day's last draft (the balance-check rule, in reconciliation).
export function toDraftRows(
  categorized: Chrono<CategorizedStatementRow>,
  baseAccountId: number,
): {
  rows: DraftRow[];
  expectedClosingByDate: Map<string, number>;
} {
  return {
    rows: categorized.map((row) => toDraftRow(row, baseAccountId)),
    expectedClosingByDate: dayClosings(
      chronoMap(categorized, (row) => row.transaction),
    ),
  };
}

export function persistDrafts(
  db: any,
  rows: DraftRow[],
  expectedClosingByDate: Map<string, number>,
  auth: LedgerAuth,
): PersistSummary {
  const summary: PersistSummary = {
    inserted: 0,
    insertedIndices: [],
    duplicates: 0,
    draftDuplicates: 0,
    journalDuplicates: 0,
    legacyMatches: 0,
    backfilled: 0,
  };
  db.transaction((tx: any) => {
    const access = auth.rowSecurity.forTable(draftTransactions);
    for (const [index, row] of rows.entries()) {
      const existing = findDuplicate(
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
      if (!existing) {
        const values = access.insertValuesSync(tx, row);
        tx.insert(draftTransactionsTable).values(values).run();
        summary.inserted++;
        summary.insertedIndices.push(index);
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

    if (rows.length > 0) {
      placeAssertionsAfterDedupe(
        tx,
        rows[0].base_account_id,
        expectedClosingByDate,
        auth,
      );
    }
  });
  return summary;
}

function placeAssertionsAfterDedupe(
  tx: any,
  baseAccountId: number,
  expectedClosingByDate: Map<string, number>,
  auth: LedgerAuth,
): void {
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
      if (!sameAmount(existing.assertion, expected)) {
        throw new AssertionConflictError(
          dateText,
          existing.assertion,
          expected,
        );
      }
    }

    // The day's last draft carries its closing, alone.
    const finalDraft = tx
      .select({ id: draftTransactionsTable.id })
      .from(draftTransactionsTable)
      .where(scopedDateWhere)
      .orderBy(...draftOrderBy("desc"))
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
